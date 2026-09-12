CREATE TYPE "public"."mistake_category" AS ENUM('wrong_logic', 'boundary_condition', 'off_by_one', 'wrong_data_structure', 'missed_edge_case', 'recursion_base_case', 'syntax_runtime', 'tle', 'none');--> statement-breakpoint
CREATE TYPE "public"."stuck_category" AS ENUM('understanding', 'approach', 'implementation', 'edge_cases', 'debugging', 'complexity');--> statement-breakpoint
CREATE TYPE "public"."stuck_source" AS ENUM('user', 'inferred');--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'stuck_marked';--> statement-breakpoint
CREATE TABLE "reflection_mistakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reflection_id" uuid NOT NULL,
	"category" "mistake_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflection_stuck_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reflection_id" uuid NOT NULL,
	"category" "stuck_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"approach" text,
	"achieved_complexity" text,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflections_approach_length" CHECK (("reflections"."approach" is null or length("reflections"."approach") <= 4000)),
	CONSTRAINT "reflections_complexity_length" CHECK (("reflections"."achieved_complexity" is null or length("reflections"."achieved_complexity") <= 120))
);
--> statement-breakpoint
CREATE TABLE "stuck_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"category" "stuck_category" NOT NULL,
	"elapsed_seconds" integer NOT NULL,
	"note" text,
	"source" "stuck_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stuck_points_elapsed_non_negative" CHECK ("stuck_points"."elapsed_seconds" >= 0),
	CONSTRAINT "stuck_points_note_length" CHECK (("stuck_points"."note" is null or length("stuck_points"."note") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "reflection_mistakes" ADD CONSTRAINT "reflection_mistakes_reflection_id_reflections_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "public"."reflections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_stuck_areas" ADD CONSTRAINT "reflection_stuck_areas_reflection_id_reflections_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "public"."reflections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stuck_points" ADD CONSTRAINT "stuck_points_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_mistakes_unique" ON "reflection_mistakes" USING btree ("reflection_id","category");--> statement-breakpoint
CREATE INDEX "reflection_mistakes_category_idx" ON "reflection_mistakes" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_stuck_areas_unique" ON "reflection_stuck_areas" USING btree ("reflection_id","category");--> statement-breakpoint
CREATE INDEX "reflection_stuck_areas_category_idx" ON "reflection_stuck_areas" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "reflections_session_key" ON "reflections" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "stuck_points_session_elapsed_idx" ON "stuck_points" USING btree ("session_id","elapsed_seconds");--> statement-breakpoint
CREATE INDEX "stuck_points_category_source_idx" ON "stuck_points" USING btree ("category","source");