-- Local recovery documentation only. Never run this against production.
--
-- Dropping these columns DELETES every user's chosen handle and their choice of
-- which sections their public page shows. Their public links stop resolving,
-- and a later re-add would default every section back to ON — re-exposing
-- sections a user had deliberately hidden. Take a backup first and treat this
-- as data loss, not a schema cleanup.
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_handle_format";
DROP INDEX IF EXISTS "user_profiles_handle_key";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "public_show_topics";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "public_show_total_solved";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "public_show_longest_streak";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "public_show_streak";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "handle";
