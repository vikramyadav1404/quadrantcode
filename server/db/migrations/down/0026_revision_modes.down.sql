-- Local recovery documentation only. Never run this against production.
--
-- Dropping these columns DELETES which revision mode every revision sitting
-- ran in, every speed target and every hit/miss — the data F2.2's mode
-- comparison is computed from. Nothing else records it. Take a backup first
-- and treat this as data loss, not a schema cleanup.
ALTER TABLE "solve_sessions" DROP CONSTRAINT IF EXISTS "solve_sessions_speed_fields_consistent";
ALTER TABLE "solve_sessions" DROP COLUMN IF EXISTS "speed_target_met";
ALTER TABLE "solve_sessions" DROP COLUMN IF EXISTS "speed_target_seconds";
ALTER TABLE "solve_sessions" DROP COLUMN IF EXISTS "revision_mode";
DROP TYPE IF EXISTS "public"."revision_mode";
