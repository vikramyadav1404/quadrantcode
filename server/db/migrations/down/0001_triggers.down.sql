-- Reverses 0001_triggers.sql
DROP TRIGGER IF EXISTS daily_sessions_touch_updated_at ON daily_sessions;
DROP TRIGGER IF EXISTS user_problems_touch_updated_at ON user_problems;
DROP TRIGGER IF EXISTS problems_touch_updated_at ON problems;
DROP TRIGGER IF EXISTS user_profiles_touch_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
DROP TRIGGER IF EXISTS users_timezone_valid ON users;
DROP FUNCTION IF EXISTS traceloop_touch_updated_at();
DROP FUNCTION IF EXISTS traceloop_assert_iana_timezone();
