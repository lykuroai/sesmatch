-- 表示用コードの形式変更: E-0001 → E000001 / P-0001 → P000001（プレフィックス+6桁ゼロ埋め）
-- 番号自体は維持し、ハイフンを除去して6桁に揃える
UPDATE "engineers"
SET "code" = 'E' || LPAD(SUBSTRING("code" FROM 3), 6, '0')
WHERE "code" ~ '^E-[0-9]+$';

UPDATE "projects"
SET "code" = 'P' || LPAD(SUBSTRING("code" FROM 3), 6, '0')
WHERE "code" ~ '^P-[0-9]+$';
