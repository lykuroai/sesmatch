# SESマッチングプラットフォーム 本番用イメージ
# build:   docker compose -f docker-compose.prod.yml build
# 3ターゲット: migrate（prisma migrate deploy 用）/ runner（アプリ本体）

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# マイグレーション実行用（docker-compose.prod.yml の migrate サービス）
FROM deps AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# アプリ本体（Next.js standalone）
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# ローカルOCR（§25: 原本画像を外部に送らない）: tesseract（日本語）と画像PDF変換用 poppler
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-jpn tesseract-ocr-data-eng poppler-utils
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# pdf-parse はトレース漏れが多い（DOMMatrix ポリフィル用の @napi-rs/canvas は
# オプション依存、pdf.worker.mjs は動的import）ため、モジュールごと明示的にコピーする
COPY --from=builder /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --from=builder /app/node_modules/pdf-parse ./node_modules/pdf-parse
RUN mkdir -p /data/storage && chown -R app:app /data
USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
