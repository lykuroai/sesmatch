-- 採番を企業単位からシステム全体に変更
-- 既存コードは作成順にシステム全体で振り直し（企業をまたいだ重複を解消）、code を全体一意にする

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

-- DropIndex
DROP INDEX "engineers_tenantCompanyId_code_key";
DROP INDEX "projects_tenantCompanyId_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "engineers_code_key" ON "engineers"("code");
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");
