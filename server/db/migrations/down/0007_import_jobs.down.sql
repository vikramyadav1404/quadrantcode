-- Down migration for 0007_import_jobs.
--
-- Order matters: import_job_rows references import_jobs, and both reference
-- tables that survive this rollback. Dropping the child first means the FKs go
-- with it rather than needing to be named.

DROP TABLE IF EXISTS "import_job_rows";
DROP TABLE IF EXISTS "import_jobs";

DROP TYPE IF EXISTS "public"."import_row_outcome";
DROP TYPE IF EXISTS "public"."import_job_status";

-- The dedup index goes before the column it indexes.
DROP INDEX IF EXISTS "problems_external_url_normalised_key";
ALTER TABLE "problems" DROP COLUMN IF EXISTS "external_url_normalised";
