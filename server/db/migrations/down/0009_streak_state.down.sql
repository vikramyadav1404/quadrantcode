-- Down migration for 0009_streak_state.
--
-- Both tables are DERIVED — everything in them can be rebuilt from
-- daily_sessions and daily_goals by recomputeStreak. Dropping them loses no
-- user data, only cached state, which is why this is a plain drop rather than
-- an archive-then-drop.
DROP TABLE IF EXISTS "streak_freezes";
DROP TABLE IF EXISTS "user_streaks";
