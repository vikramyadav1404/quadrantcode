-- A paper may name no company: a general mock OA built from Quadrantcode
-- originals. Only relaxes a constraint, so every existing row stays valid and
-- nothing is rewritten.
ALTER TABLE "assessment_papers" ALTER COLUMN "company_id" DROP NOT NULL;
