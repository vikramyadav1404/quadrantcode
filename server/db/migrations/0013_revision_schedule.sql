CREATE TYPE "public"."ladder_kind" AS ENUM('standard', 'compressed');--> statement-breakpoint
CREATE TYPE "public"."revision_outcome" AS ENUM('clean', 'struggled', 'failed');--> statement-breakpoint
CREATE TABLE "revision_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"ladder_kind" "ladder_kind" DEFAULT 'standard' NOT NULL,
	"ladder_index" smallint DEFAULT 0 NOT NULL,
	"interval_days" smallint NOT NULL,
	"due_local_date" date NOT NULL,
	"last_revised_local_date" date,
	"revision_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_schedule_interval_at_least_one_day" CHECK ("revision_schedule"."interval_days" >= 1),
	CONSTRAINT "revision_schedule_index_non_negative" CHECK ("revision_schedule"."ladder_index" >= 0 and "revision_schedule"."revision_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "revision_schedule" ADD CONSTRAINT "revision_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_schedule" ADD CONSTRAINT "revision_schedule_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revision_schedule_user_problem_key" ON "revision_schedule" USING btree ("user_id","problem_id");--> statement-breakpoint
CREATE INDEX "revision_schedule_due_idx" ON "revision_schedule" USING btree ("user_id","due_local_date");