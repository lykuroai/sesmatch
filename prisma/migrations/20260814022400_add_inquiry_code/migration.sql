-- お問合せ番号（Q+6桁）を追加。既存行には作成順で採番してから NOT NULL 化する
ALTER TABLE "inquiries" ADD COLUMN "code" TEXT;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn FROM "inquiries"
)
UPDATE "inquiries" i
SET "code" = 'Q' || LPAD(numbered.rn::text, 6, '0')
FROM numbered
WHERE i.id = numbered.id;

ALTER TABLE "inquiries" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "inquiries_code_key" ON "inquiries"("code");
