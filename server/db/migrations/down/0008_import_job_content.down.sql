-- Down migration for 0008_import_job_content.
--
-- Dropping the column loses every stored upload, which is the point of the
-- rollback: without it a job cannot be resumed or re-run, so keeping the data
-- would leave rows that claim to be resumable and are not.
ALTER TABLE "import_jobs" DROP COLUMN IF EXISTS "content";
