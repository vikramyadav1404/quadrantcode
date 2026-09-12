-- Down migration for 0014_execution_pipeline.
--
-- THIS DESTROYS USER DATA. `run_attempts` is the record of what a user ran and
-- what came back; `execution_jobs` holds the source they submitted. Neither is
-- derived, and F3.2's timeline will read both.
--
-- Children first, though the FK cascades — relying on a cascade during a
-- rollback hides which table is actually being dropped.
DROP TABLE IF EXISTS "run_attempts";
DROP TABLE IF EXISTS "execution_jobs";

DROP TYPE IF EXISTS "public"."execution_verdict";
DROP TYPE IF EXISTS "public"."execution_status";
DROP TYPE IF EXISTS "public"."execution_language";
