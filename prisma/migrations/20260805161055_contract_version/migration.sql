-- 契約内容の版数。修正のたびに+1し、署名は閲覧した版に対してのみ有効にする
-- （相手方が修正した直後に、修正前の内容を見たまま署名してしまう競合の防止）
ALTER TABLE "contracts" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
