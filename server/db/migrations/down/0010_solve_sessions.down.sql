-- Down migration for 0010_solve_sessions.
--
-- UNLIKE 0009, THIS DESTROYS USER DATA. `user_streaks` and `streak_freezes` are
-- derived and can be rebuilt from the days; a solve session is a primary record
-- of something the user did, and nothing else holds it. Rolling this back on a
-- database with real sessions loses them permanently.
--
-- It is still a plain drop rather than an archive-then-drop, because a down
-- migration that leaves tables behind does not undo the migration — the next
-- `up` then fails on objects that already exist, which is how a rollback path
-- quietly stops working. If the data matters, dump it before rolling back.
--
-- Order: session_events first. Its FK to solve_sessions is ON DELETE CASCADE,
-- so the reverse order would work too, but relying on a cascade to clean up
-- during a rollback hides which table is actually being dropped.
DROP TABLE IF EXISTS "session_events";
DROP TABLE IF EXISTS "solve_sessions";

-- The enums are dropped after their only consumers. `confidence` is NOT dropped:
-- it predates this migration (F0.2) and `user_problems` still uses it.
DROP TYPE IF EXISTS "public"."session_event_type";
DROP TYPE IF EXISTS "public"."solve_session_status";
