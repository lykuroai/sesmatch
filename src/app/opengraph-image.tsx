import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// 全ページ共通のOGP画像（1200x630）。og-font.ttf は画像内の文字だけに
// サブセットした Noto Sans JP Bold — 文言を変えたらフォントも作り直すこと
export const alt = "SES DirectMatch — SES企業向けAI案件・人材マッチング";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const notoSansJpBold = await readFile(join(process.cwd(), "src/app/og-font.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          background: "linear-gradient(135deg, #1e3a8a 0%, #172554 100%)",
          color: "#ffffff",
          fontFamily: "Noto Sans JP",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              display: "flex",
              width: 104,
              height: 104,
              borderRadius: 24,
              background: "linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="76" height="76" viewBox="0 0 64 64">
              <path
                d="M16 20 L38 32 L16 44"
                fill="none"
                stroke="#ffffff"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M48 20 L26 32 L48 44"
                fill="none"
                stroke="#34d399"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 62, fontWeight: 700 }}>SES DirectMatch</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              fontSize: 28,
              padding: "8px 24px",
              borderRadius: 9999,
              background: "rgba(52, 211, 153, 0.18)",
              border: "2px solid #34d399",
              color: "#a7f3d0",
            }}
          >
            SES企業向け
          </div>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 700, lineHeight: 1.25 }}>
            AI案件・人材ダイレクトマッチング
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#bfdbfe", lineHeight: 1.5 }}>
            案件票・スキルシートを貼り付け・取り込むだけ。AIが最適な案件・人材を提案。
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#93c5fd" }}>ses.lykuro.ai</div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Noto Sans JP", data: notoSansJpBold, weight: 700, style: "normal" }],
    },
  );
}
