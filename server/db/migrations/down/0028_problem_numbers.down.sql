-- Local recovery documentation only. Never run this against production.
--
-- Dropping the column deletes every problem's public number. A later re-add
-- would number the rows again from scratch, and nothing guarantees the same
-- order: a number a reader wrote down could then point at a different problem.
-- Treat this as data loss, not a schema cleanup.
DROP INDEX IF EXISTS "problems_status_difficulty_number_idx";
DROP INDEX IF EXISTS "problems_number_key";
ALTER TABLE "problems" DROP COLUMN IF EXISTS "number";
