DROP TABLE IF EXISTS assessment_answers;
DROP TABLE IF EXISTS assessment_attempts;
DROP TABLE IF EXISTS assessment_paper_questions;
DROP TABLE IF EXISTS assessment_papers;
DROP TABLE IF EXISTS moderation_decisions;
DROP TABLE IF EXISTS interview_report_questions;
DROP TABLE IF EXISTS interview_reports;
DROP TABLE IF EXISTS problem_company_evidence;
DROP TABLE IF EXISTS editorials;
DROP TABLE IF EXISTS problem_language_templates;
DROP TABLE IF EXISTS test_cases;
DROP TABLE IF EXISTS problem_examples;
DROP TABLE IF EXISTS problem_topics;
DROP TABLE IF EXISTS problem_versions;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS content_licenses;

ALTER TABLE run_attempts DROP CONSTRAINT IF EXISTS run_attempts_server_verification_coherent;
ALTER TABLE run_attempts DROP COLUMN IF EXISTS test_results;
ALTER TABLE run_attempts DROP COLUMN IF EXISTS compiler_runtime_version;
ALTER TABLE run_attempts DROP COLUMN IF EXISTS provider_name;
ALTER TABLE run_attempts DROP COLUMN IF EXISTS server_verified_at;
ALTER TABLE run_attempts DROP COLUMN IF EXISTS server_verified;

ALTER TABLE execution_jobs DROP COLUMN IF EXISTS problem_version;
ALTER TABLE execution_jobs DROP COLUMN IF EXISTS mode;

ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_submission_counts_coherent;
ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_current_version_positive;
ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_difficulty_calibration_range;
ALTER TABLE problems DROP COLUMN IF EXISTS total_submissions;
ALTER TABLE problems DROP COLUMN IF EXISTS accepted_submissions;
ALTER TABLE problems DROP COLUMN IF EXISTS current_version;
ALTER TABLE problems DROP COLUMN IF EXISTS difficulty_calibration;

DROP TYPE IF EXISTS assessment_attempt_status;
DROP TYPE IF EXISTS assessment_paper_type;
DROP TYPE IF EXISTS candidate_level;
DROP TYPE IF EXISTS evidence_type;
DROP TYPE IF EXISTS evidence_verification_status;
DROP TYPE IF EXISTS execution_mode;
DROP TYPE IF EXISTS moderation_action;
DROP TYPE IF EXISTS moderation_status;
DROP TYPE IF EXISTS problem_type;
DROP TYPE IF EXISTS test_case_visibility;

-- PostgreSQL cannot remove individual enum values safely. The forward migration
-- uses ADD VALUE IF NOT EXISTS so a one-step rollback/re-apply stays idempotent;
-- the original enum types are removed by 0000 during a full rollback.
