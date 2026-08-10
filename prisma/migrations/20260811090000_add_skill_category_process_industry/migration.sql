-- スキル分類に工程・業種を追加（取込時に工程・業種経験をスキルとしても登録するため）
ALTER TYPE "SkillCategory" ADD VALUE IF NOT EXISTS 'PROCESS';
ALTER TYPE "SkillCategory" ADD VALUE IF NOT EXISTS 'INDUSTRY';
