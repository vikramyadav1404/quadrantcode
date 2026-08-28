-- Down migration for 0018_mistake_memory.
--
-- `mistake_patterns` is DERIVED — a rollup of confirmed stuck points and
-- reflection mistakes. Dropping it loses nothing that `npm run mistakes:rollup`
-- cannot rebuild, which is the same position F1.6's analytics tables are in.
--
-- `mistake_warnings_shown` is NOT derived. It records that a user was shown a
-- particular warning on a particular day, and dropping it means every pattern's
-- warning can appear again immediately — including ones the user dismissed.
-- That is a small harm rather than lost history, and it is written here so
-- nobody has to work it out from the column names.
DROP TABLE IF EXISTS "mistake_warnings_shown";
--> statement-breakpoint
DROP TABLE IF EXISTS "mistake_patterns";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mistake_trend";
