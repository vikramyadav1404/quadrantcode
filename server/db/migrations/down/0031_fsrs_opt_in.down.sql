-- Local recovery documentation only. Never run this against production.
--
-- Drops each user's scheduler choice and every row's FSRS state. Due dates FSRS
-- already set stay as they are; the ladder carries on from them.
ALTER TABLE "revision_schedule" DROP CONSTRAINT IF EXISTS "revision_schedule_fsrs_state";
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_revision_scheduler";
ALTER TABLE "revision_schedule" DROP COLUMN IF EXISTS "fsrs_difficulty";
ALTER TABLE "revision_schedule" DROP COLUMN IF EXISTS "fsrs_stability";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "revision_scheduler";
