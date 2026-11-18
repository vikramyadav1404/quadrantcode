-- FSRS as an opt-in scheduler. Additive only: every existing profile gets
-- 'ladder' (today's behaviour) and every existing schedule row gets null FSRS
-- state, so no date or row changes.
ALTER TABLE "user_profiles" ADD COLUMN "revision_scheduler" text DEFAULT 'ladder' NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_schedule" ADD COLUMN "fsrs_stability" real;--> statement-breakpoint
ALTER TABLE "revision_schedule" ADD COLUMN "fsrs_difficulty" real;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_revision_scheduler" CHECK ("user_profiles"."revision_scheduler" in ('ladder', 'fsrs'));--> statement-breakpoint
ALTER TABLE "revision_schedule" ADD CONSTRAINT "revision_schedule_fsrs_state" CHECK (("revision_schedule"."fsrs_stability" is null and "revision_schedule"."fsrs_difficulty" is null)
          or ("revision_schedule"."fsrs_stability" is not null and "revision_schedule"."fsrs_difficulty" is not null
              and "revision_schedule"."fsrs_stability" > 0 and "revision_schedule"."fsrs_difficulty" between 1 and 10));