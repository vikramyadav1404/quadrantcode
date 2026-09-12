CREATE TYPE "public"."execution_backend" AS ENUM('legacy', 'vercel_sandbox', 'judge0', 'fake');--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "backend" "execution_backend" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "dispatch_attempt_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "queue_message_id" text;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "queue_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "attempt_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "sandbox_name" text;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "sandbox_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "cleanup_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "last_error_code" text;--> statement-breakpoint
CREATE INDEX "execution_jobs_dispatch_reconcile_idx" ON "execution_jobs" USING btree ("next_attempt_at","created_at") WHERE "execution_jobs"."status" = 'queued' and "execution_jobs"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "execution_jobs_expired_lease_idx" ON "execution_jobs" USING btree ("lease_expires_at") WHERE "execution_jobs"."status" = 'running' and "execution_jobs"."lease_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "execution_jobs_daily_created_idx" ON "execution_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "execution_jobs_cleanup_pending_idx" ON "execution_jobs" USING btree ("updated_at") WHERE "execution_jobs"."cleanup_pending" is true;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_attempt_counts_non_negative" CHECK ("execution_jobs"."dispatch_attempt_count" >= 0 and "execution_jobs"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_lease_pair_coherent" CHECK (("execution_jobs"."lease_token" is null) = ("execution_jobs"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_claimed_lease_present" CHECK ("execution_jobs"."backend" = 'legacy' or "execution_jobs"."status" <> 'running'
          or ("execution_jobs"."lease_token" is not null and "execution_jobs"."lease_expires_at" is not null));