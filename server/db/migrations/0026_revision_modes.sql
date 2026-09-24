CREATE TYPE "public"."revision_mode" AS ENUM('blind', 'mistake_first', 'pattern', 'speed');--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD COLUMN "revision_mode" "revision_mode";--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD COLUMN "speed_target_seconds" integer;--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD COLUMN "speed_target_met" boolean;--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD CONSTRAINT "solve_sessions_speed_fields_consistent" CHECK (
      ("solve_sessions"."revision_mode" = 'speed'
        and "solve_sessions"."speed_target_seconds" is not null and "solve_sessions"."speed_target_seconds" > 0
        and ("solve_sessions"."speed_target_met" is null or "solve_sessions"."status" in ('solved', 'stuck', 'abandoned')))
      or
      ("solve_sessions"."revision_mode" is distinct from 'speed'
        and "solve_sessions"."speed_target_seconds" is null and "solve_sessions"."speed_target_met" is null)
    );