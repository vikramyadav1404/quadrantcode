-- Down migration for 0013_revision_schedule.
--
-- THIS DESTROYS USER DATA, like 0010 and 0011 and unlike 0012. A revision
-- schedule is not derived: it is the accumulated result of how each revision
-- actually went, and nothing else records that history. Rebuilding it from
-- solve sessions would put every problem back at day one and lose months of
-- ladder progress.
--
-- Dump before rolling back if the data matters.
DROP TABLE IF EXISTS "revision_schedule";

-- `revision_outcome` is dropped with it: F2.1 is the only thing that uses it,
-- and it is created by this migration.
DROP TYPE IF EXISTS "public"."ladder_kind";
DROP TYPE IF EXISTS "public"."revision_outcome";
