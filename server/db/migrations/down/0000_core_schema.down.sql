-- Reverses 0000_core_schema.sql
-- Dropped child-first so foreign keys never block the drop.
DROP TABLE IF EXISTS daily_sessions;
DROP TABLE IF EXISTS daily_goals;
DROP TABLE IF EXISTS user_problems;
DROP TABLE IF EXISTS problem_tags;
DROP TABLE IF EXISTS problems;
DROP TABLE IF EXISTS verification_methods;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS confidence;
DROP TYPE IF EXISTS user_problem_status;
DROP TYPE IF EXISTS problem_tag_type;
DROP TYPE IF EXISTS problem_status;
DROP TYPE IF EXISTS difficulty;
DROP TYPE IF EXISTS problem_source_type;
DROP TYPE IF EXISTS verification_method;
DROP TYPE IF EXISTS user_role;
