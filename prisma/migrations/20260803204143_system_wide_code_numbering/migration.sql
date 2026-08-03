-- 採番を企業単位からシステム全体に変更
-- 既存コードは作成順にシステム全体で振り直し（企業をまたいだ重複を解消）、code を全体一意にする
-- 注意: 旧ユニーク制約（tenantCompanyId, code）が残ったまま UPDATE すると更新途中の行が
-- 既存行と衝突するため、必ず制約を先に削除してから振り直す

-- DropIndex（振り直しの前に行う）
DROP INDEX IF EXISTS "engineers_tenantCompanyId_code_key";
DROP INDEX IF EXISTS "projects_tenantCompanyId_code_key";

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "engineers"
)
UPDATE "engineers" e SET "code" = 'E' || LPAD(n.rn::text, 6, '0')
FROM numbered n WHERE e.id = n.id;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "projects"
)
UPDATE "projects" p SET "code" = 'P' || LPAD(n.rn::text, 6, '0')
FROM numbered n WHERE p.id = n.id;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "engineers_code_key" ON "engineers"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "projects_code_key" ON "projects"("code");
