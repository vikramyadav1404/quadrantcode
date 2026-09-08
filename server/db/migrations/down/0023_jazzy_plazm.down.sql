ALTER TABLE test_cases DROP COLUMN IF EXISTS coverage;
ALTER TABLE problem_versions DROP COLUMN IF EXISTS reference_validation_summary;
ALTER TABLE problem_versions DROP COLUMN IF EXISTS reference_validation_provider;
ALTER TABLE problem_versions DROP COLUMN IF EXISTS reference_validated_at;
DROP TYPE IF EXISTS test_case_coverage;
