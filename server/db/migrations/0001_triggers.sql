-- F0.2 · database-level invariants that a column CHECK cannot express.
--
-- 1. `users.timezone` must be a real IANA identifier. A CHECK constraint may
--    not contain a subquery, so validation against pg_timezone_names has to be
--    a trigger. Doing it here rather than only in Zod means a psql session, a
--    bulk import and a future service all get the same guarantee.
-- 2. `updated_at` is maintained by the database, so no service can forget it.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION quadrantcode_assert_iana_timezone()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid IANA timezone: %', NEW.timezone
      USING ERRCODE = 'check_violation',
            HINT = 'Use an identifier from pg_timezone_names, e.g. Asia/Kolkata.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER users_timezone_valid
BEFORE INSERT OR UPDATE OF timezone ON users
FOR EACH ROW EXECUTE FUNCTION quadrantcode_assert_iana_timezone();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION quadrantcode_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER users_touch_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION quadrantcode_touch_updated_at();

--> statement-breakpoint
CREATE TRIGGER user_profiles_touch_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION quadrantcode_touch_updated_at();

--> statement-breakpoint
CREATE TRIGGER problems_touch_updated_at
BEFORE UPDATE ON problems
FOR EACH ROW EXECUTE FUNCTION quadrantcode_touch_updated_at();

--> statement-breakpoint
CREATE TRIGGER user_problems_touch_updated_at
BEFORE UPDATE ON user_problems
FOR EACH ROW EXECUTE FUNCTION quadrantcode_touch_updated_at();

--> statement-breakpoint
CREATE TRIGGER daily_sessions_touch_updated_at
BEFORE UPDATE ON daily_sessions
FOR EACH ROW EXECUTE FUNCTION quadrantcode_touch_updated_at();
