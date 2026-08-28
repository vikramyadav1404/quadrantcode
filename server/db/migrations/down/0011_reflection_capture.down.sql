-- Down migration for 0011_reflection_capture.
--
-- LIKE 0010, THIS DESTROYS USER DATA. A reflection is a person's account of how
-- a solve went; nothing else holds it, and it cannot be recomputed. Dump before
-- rolling back if the data matters.
--
-- Children first. The FKs cascade, so the reverse order would work, but relying
-- on a cascade during a rollback hides which table is actually being dropped.
DROP TABLE IF EXISTS "reflection_mistakes";
DROP TABLE IF EXISTS "reflection_stuck_areas";
DROP TABLE IF EXISTS "reflections";
DROP TABLE IF EXISTS "stuck_points";

DROP TYPE IF EXISTS "public"."mistake_category";
DROP TYPE IF EXISTS "public"."stuck_category";
DROP TYPE IF EXISTS "public"."stuck_source";

-- `stuck_marked` STAYS IN session_event_type, and cannot be removed.
--
-- Postgres has no `ALTER TYPE ... DROP VALUE`. Undoing it properly would mean
-- recreating the type without that label and rewriting every column that uses
-- it — a table rewrite, during a rollback, to remove a label that harms nothing
-- by remaining.
--
-- So the up migration says `ADD VALUE IF NOT EXISTS` instead. That is what keeps
-- a single-step rollback re-appliable: roll back 0011 alone and the label
-- survives, and re-applying does not fail on "label already exists". A full
-- rollback is unaffected either way, because 0010's down drops the whole type.
--
-- If `npm run db:generate` ever rewrites this migration, check that the
-- IF NOT EXISTS survived — drizzle does not emit it.
