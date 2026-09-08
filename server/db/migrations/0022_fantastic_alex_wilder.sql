ALTER TABLE "assessment_attempts" ADD COLUMN "active_question_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "last_interaction_at" timestamp with time zone;--> statement-breakpoint
UPDATE "assessment_attempts" SET "last_interaction_at" = "started_at" WHERE "last_interaction_at" IS NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ALTER COLUMN "last_interaction_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_active_question_id_assessment_paper_questions_id_fk" FOREIGN KEY ("active_question_id") REFERENCES "public"."assessment_paper_questions"("id") ON DELETE set null ON UPDATE no action;
