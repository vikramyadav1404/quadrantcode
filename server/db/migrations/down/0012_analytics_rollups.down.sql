-- Down migration for 0012_analytics_rollups.
--
-- SAFE, UNLIKE 0010 AND 0011. Everything in these three tables is DERIVED:
-- `rollUpDays` rebuilds all of it from sessions, reflections and problem tags.
-- Dropping them loses precomputation, not data — the same argument 0009 makes
-- for the streak tables.
--
-- The only cost of rolling this back is the first dashboard load afterwards,
-- which has to rebuild what it needs.
DROP TABLE IF EXISTS "analytics_stuck_daily";
DROP TABLE IF EXISTS "analytics_topic_daily";
DROP TABLE IF EXISTS "analytics_daily";
