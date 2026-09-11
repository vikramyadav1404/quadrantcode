-- Local recovery documentation only. Never run this against production.
DROP INDEX IF EXISTS "execution_jobs_cleanup_pending_idx";
DROP INDEX IF EXISTS "execution_jobs_daily_created_idx";
DROP INDEX IF EXISTS "execution_jobs_expired_lease_idx";
DROP INDEX IF EXISTS "execution_jobs_dispatch_reconcile_idx";
ALTER TABLE "execution_jobs" DROP CONSTRAINT IF EXISTS "execution_jobs_claimed_lease_present";
ALTER TABLE "execution_jobs" DROP CONSTRAINT IF EXISTS "execution_jobs_lease_pair_coherent";
ALTER TABLE "execution_jobs" DROP CONSTRAINT IF EXISTS "execution_jobs_attempt_counts_non_negative";
ALTER TABLE "execution_jobs"
  DROP COLUMN IF EXISTS "last_error_code",
  DROP COLUMN IF EXISTS "cleanup_pending",
  DROP COLUMN IF EXISTS "sandbox_expires_at",
  DROP COLUMN IF EXISTS "sandbox_name",
  DROP COLUMN IF EXISTS "lease_expires_at",
  DROP COLUMN IF EXISTS "lease_token",
  DROP COLUMN IF EXISTS "next_attempt_at",
  DROP COLUMN IF EXISTS "attempt_count",
  DROP COLUMN IF EXISTS "queue_expires_at",
  DROP COLUMN IF EXISTS "dispatched_at",
  DROP COLUMN IF EXISTS "queue_message_id",
  DROP COLUMN IF EXISTS "dispatch_attempt_count",
  DROP COLUMN IF EXISTS "backend";
DROP TYPE IF EXISTS "public"."execution_backend";
