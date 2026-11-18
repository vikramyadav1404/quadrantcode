-- Local recovery documentation only. Never run this against production.
--
-- Restoring NOT NULL fails while any general (company-less) paper exists.
-- Removing those papers first would also remove their questions and every
-- attempt taken on them, so treat that as data loss, not a schema cleanup.
ALTER TABLE "assessment_papers" ALTER COLUMN "company_id" SET NOT NULL;
