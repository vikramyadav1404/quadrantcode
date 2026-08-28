CREATE TYPE "public"."stuck_confidence" AS ENUM('user_marked', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."stuck_status" AS ENUM('inferred', 'confirmed', 'dismissed');--> statement-breakpoint
ALTER TABLE "stuck_points" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "status" "stuck_status" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "confidence" "stuck_confidence" DEFAULT 'user_marked' NOT NULL;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "line_start" integer;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "line_end" integer;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "started_seconds" integer;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "ended_seconds" integer;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD CONSTRAINT "stuck_points_user_has_category" CHECK (("stuck_points"."source" = 'user' and "stuck_points"."category" is not null)
          or "stuck_points"."source" = 'inferred');--> statement-breakpoint
ALTER TABLE "stuck_points" ADD CONSTRAINT "stuck_points_line_range_coherent" CHECK (("stuck_points"."line_start" is null and "stuck_points"."line_end" is null)
          or ("stuck_points"."line_start" is not null and "stuck_points"."line_end" is not null
              and "stuck_points"."line_start" >= 1 and "stuck_points"."line_end" >= "stuck_points"."line_start"));