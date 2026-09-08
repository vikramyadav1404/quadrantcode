CREATE TYPE "public"."assessment_attempt_status" AS ENUM('in_progress', 'submitted', 'auto_submitted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."assessment_paper_type" AS ENUM('official_sample', 'verified_past_paper', 'candidate_reported_set', 'pattern_based_mock');--> statement-breakpoint
CREATE TYPE "public"."candidate_level" AS ENUM('internship', 'fresher', 'experienced');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('official_sample', 'verified_pyq', 'candidate_reported', 'frequently_reported', 'company_pattern', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."evidence_verification_status" AS ENUM('unverified', 'reviewed', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('run', 'submit', 'assessment');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('submitted', 'requested_changes', 'approved', 'rejected', 'published', 'archived', 'edited', 'grouped');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('draft', 'pending_review', 'needs_changes', 'approved', 'rejected', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."problem_type" AS ENUM('function');--> statement-breakpoint
CREATE TYPE "public"."test_case_visibility" AS ENUM('sample', 'visible', 'hidden');--> statement-breakpoint
ALTER TYPE "public"."execution_language" ADD VALUE IF NOT EXISTS 'c11' BEFORE 'cpp17';--> statement-breakpoint
ALTER TYPE "public"."problem_status" ADD VALUE IF NOT EXISTS 'needs_review' BEFORE 'review';--> statement-breakpoint
CREATE TABLE "assessment_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"paper_question_id" uuid NOT NULL,
	"language" "execution_language" NOT NULL,
	"source" text NOT NULL,
	"execution_job_id" uuid,
	"verdict" "execution_verdict",
	"marks_awarded" smallint DEFAULT 0 NOT NULL,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_answers_source_not_empty" CHECK (length("assessment_answers"."source") > 0),
	CONSTRAINT "assessment_answers_marks_non_negative" CHECK ("assessment_answers"."marks_awarded" >= 0),
	CONSTRAINT "assessment_answers_time_non_negative" CHECK ("assessment_answers"."time_spent_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "assessment_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"maximum_score" integer NOT NULL,
	"verdict_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_attempts_expiry_after_start" CHECK ("assessment_attempts"."expires_at" > "assessment_attempts"."started_at"),
	CONSTRAINT "assessment_attempts_score_coherent" CHECK ("assessment_attempts"."score" >= 0 and "assessment_attempts"."maximum_score" >= "assessment_attempts"."score"),
	CONSTRAINT "assessment_attempts_terminal_has_submission" CHECK ("assessment_attempts"."status" = 'in_progress' or "assessment_attempts"."submitted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "assessment_paper_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"marks" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_paper_questions_ordinal_positive" CHECK ("assessment_paper_questions"."ordinal" > 0),
	CONSTRAINT "assessment_paper_questions_marks_positive" CHECK ("assessment_paper_questions"."marks" > 0)
);
--> statement-breakpoint
CREATE TABLE "assessment_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"role" text NOT NULL,
	"pattern_period" text NOT NULL,
	"paper_type" "assessment_paper_type" DEFAULT 'pattern_based_mock' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"instructions" text NOT NULL,
	"status" "problem_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_license_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_papers_duration_positive" CHECK ("assessment_papers"."duration_minutes" > 0),
	CONSTRAINT "assessment_papers_version_positive" CHECK ("assessment_papers"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"overview" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_normalised" CHECK ("companies"."slug" = lower("companies"."slug"))
);
--> statement-breakpoint
CREATE TABLE "content_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provenance" text NOT NULL,
	"license_name" text NOT NULL,
	"license_url" text,
	"author" text DEFAULT 'Quadrantcode editorial team' NOT NULL,
	"independently_created" boolean DEFAULT true NOT NULL,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_licenses_provenance_not_empty" CHECK (length("content_licenses"."provenance") > 0),
	CONSTRAINT "content_licenses_name_not_empty" CHECK (length("content_licenses"."license_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "editorials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_version_id" uuid NOT NULL,
	"overview" text NOT NULL,
	"brute_force_approach" text,
	"optimal_approach" text NOT NULL,
	"correctness_proof" text NOT NULL,
	"time_complexity" text NOT NULL,
	"space_complexity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorials_overview_not_empty" CHECK (length("editorials"."overview") > 0),
	CONSTRAINT "editorials_optimal_not_empty" CHECK (length("editorials"."optimal_approach") > 0)
);
--> statement-breakpoint
CREATE TABLE "interview_report_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"concept" text NOT NULL,
	"recollection" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"topic_slugs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_report_questions_ordinal_positive" CHECK ("interview_report_questions"."ordinal" > 0),
	CONSTRAINT "interview_report_questions_concept_not_empty" CHECK (length("interview_report_questions"."concept") > 0),
	CONSTRAINT "interview_report_questions_recollection_not_empty" CHECK (length("interview_report_questions"."recollection") > 0)
);
--> statement-breakpoint
CREATE TABLE "interview_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"candidate_level" "candidate_level" NOT NULL,
	"interview_year" smallint NOT NULL,
	"location" text,
	"round" text NOT NULL,
	"experience" text NOT NULL,
	"public_source_url" text,
	"display_anonymously" boolean DEFAULT false NOT NULL,
	"original_and_nda_safe" boolean NOT NULL,
	"display_permission" boolean NOT NULL,
	"status" "moderation_status" DEFAULT 'draft' NOT NULL,
	"duplicate_group_key" text,
	"safety_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_reports_role_not_empty" CHECK (length("interview_reports"."role") > 0),
	CONSTRAINT "interview_reports_round_not_empty" CHECK (length("interview_reports"."round") > 0),
	CONSTRAINT "interview_reports_experience_not_empty" CHECK (length("interview_reports"."experience") > 0),
	CONSTRAINT "interview_reports_publish_consent" CHECK ("interview_reports"."status" <> 'published' or ("interview_reports"."original_and_nda_safe" and "interview_reports"."display_permission" and "interview_reports"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"moderator_id" uuid,
	"action" "moderation_action" NOT NULL,
	"from_status" "moderation_status" NOT NULL,
	"to_status" "moderation_status" NOT NULL,
	"reason" text NOT NULL,
	"source_reviewed" boolean DEFAULT false NOT NULL,
	"originality_reviewed" boolean DEFAULT false NOT NULL,
	"nda_safe" boolean DEFAULT false NOT NULL,
	"assigned_evidence_type" "evidence_type",
	"edited_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_decisions_reason_not_empty" CHECK (length("moderation_decisions"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE "problem_company_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text,
	"round" text,
	"candidate_level" "candidate_level",
	"year_from" smallint,
	"year_to" smallint,
	"location" text,
	"evidence_type" "evidence_type" DEFAULT 'company_pattern' NOT NULL,
	"source_url" text,
	"report_count" integer DEFAULT 0 NOT NULL,
	"confidence_score" smallint DEFAULT 0 NOT NULL,
	"verification_status" "evidence_verification_status" DEFAULT 'unverified' NOT NULL,
	"last_reviewed_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_company_evidence_confidence_range" CHECK ("problem_company_evidence"."confidence_score" between 0 and 100),
	CONSTRAINT "problem_company_evidence_report_count_non_negative" CHECK ("problem_company_evidence"."report_count" >= 0),
	CONSTRAINT "problem_company_evidence_year_range" CHECK ("problem_company_evidence"."year_from" is null or "problem_company_evidence"."year_to" is null or "problem_company_evidence"."year_to" >= "problem_company_evidence"."year_from"),
	CONSTRAINT "problem_company_evidence_verified_source" CHECK ("problem_company_evidence"."evidence_type" not in ('official_sample', 'verified_pyq') or ("problem_company_evidence"."source_url" is not null and "problem_company_evidence"."verification_status" = 'verified')),
	CONSTRAINT "problem_company_evidence_frequent_threshold" CHECK ("problem_company_evidence"."evidence_type" <> 'frequently_reported' or "problem_company_evidence"."report_count" >= 3)
);
--> statement-breakpoint
CREATE TABLE "problem_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_version_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"input" text NOT NULL,
	"output" text NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_examples_ordinal_positive" CHECK ("problem_examples"."ordinal" > 0),
	CONSTRAINT "problem_examples_explanation_not_empty" CHECK (length("problem_examples"."explanation") > 0)
);
--> statement-breakpoint
CREATE TABLE "problem_language_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_version_id" uuid NOT NULL,
	"language" "execution_language" NOT NULL,
	"display_name" text NOT NULL,
	"runtime_version" text,
	"judge0_language_id" integer,
	"function_signature" text NOT NULL,
	"starter_code" text NOT NULL,
	"wrapper_template" text NOT NULL,
	"serialization" jsonb NOT NULL,
	"reference_solution" text NOT NULL,
	"validation_hash" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_language_templates_starter_not_empty" CHECK (length("problem_language_templates"."starter_code") > 0),
	CONSTRAINT "problem_language_templates_reference_not_empty" CHECK (length("problem_language_templates"."reference_solution") > 0)
);
--> statement-breakpoint
CREATE TABLE "problem_topics" (
	"problem_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "problem_topics_problem_id_topic_id_pk" PRIMARY KEY("problem_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "problem_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "problem_status" DEFAULT 'draft' NOT NULL,
	"problem_type" "problem_type" DEFAULT 'function' NOT NULL,
	"story" text NOT NULL,
	"statement" text NOT NULL,
	"input_format" text NOT NULL,
	"output_format" text NOT NULL,
	"function_contract" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"hints" jsonb NOT NULL,
	"time_limit_ms" integer NOT NULL,
	"memory_limit_kb" integer NOT NULL,
	"content_license_id" uuid NOT NULL,
	"provenance" text NOT NULL,
	"review_notes" text,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_versions_version_positive" CHECK ("problem_versions"."version" > 0),
	CONSTRAINT "problem_versions_time_limit_positive" CHECK ("problem_versions"."time_limit_ms" > 0),
	CONSTRAINT "problem_versions_memory_limit_positive" CHECK ("problem_versions"."memory_limit_kb" > 0),
	CONSTRAINT "problem_versions_story_not_empty" CHECK (length("problem_versions"."story") > 0),
	CONSTRAINT "problem_versions_statement_not_empty" CHECK (length("problem_versions"."statement") > 0),
	CONSTRAINT "problem_versions_publish_time_coherent" CHECK (("problem_versions"."status" = 'published' and "problem_versions"."published_at" is not null) or "problem_versions"."status" <> 'published')
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_version_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"visibility" "test_case_visibility" NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	"explanation" text,
	"weight" smallint DEFAULT 1 NOT NULL,
	"is_performance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_cases_ordinal_positive" CHECK ("test_cases"."ordinal" > 0),
	CONSTRAINT "test_cases_weight_positive" CHECK ("test_cases"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_normalised" CHECK ("topics"."slug" = lower("topics"."slug"))
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "difficulty_calibration" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "accepted_submissions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "total_submissions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "mode" "execution_mode" DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD COLUMN "problem_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "server_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "server_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "compiler_runtime_version" text;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "test_results" jsonb;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_paper_question_id_assessment_paper_questions_id_fk" FOREIGN KEY ("paper_question_id") REFERENCES "public"."assessment_paper_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_execution_job_id_execution_jobs_id_fk" FOREIGN KEY ("execution_job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_paper_id_assessment_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."assessment_papers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_paper_questions" ADD CONSTRAINT "assessment_paper_questions_paper_id_assessment_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."assessment_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_paper_questions" ADD CONSTRAINT "assessment_paper_questions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_papers" ADD CONSTRAINT "assessment_papers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_papers" ADD CONSTRAINT "assessment_papers_content_license_id_content_licenses_id_fk" FOREIGN KEY ("content_license_id") REFERENCES "public"."content_licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_papers" ADD CONSTRAINT "assessment_papers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorials" ADD CONSTRAINT "editorials_problem_version_id_problem_versions_id_fk" FOREIGN KEY ("problem_version_id") REFERENCES "public"."problem_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_report_questions" ADD CONSTRAINT "interview_report_questions_report_id_interview_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."interview_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_reports" ADD CONSTRAINT "interview_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_reports" ADD CONSTRAINT "interview_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_report_id_interview_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."interview_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_company_evidence" ADD CONSTRAINT "problem_company_evidence_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_company_evidence" ADD CONSTRAINT "problem_company_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_company_evidence" ADD CONSTRAINT "problem_company_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_examples" ADD CONSTRAINT "problem_examples_problem_version_id_problem_versions_id_fk" FOREIGN KEY ("problem_version_id") REFERENCES "public"."problem_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_language_templates" ADD CONSTRAINT "problem_language_templates_problem_version_id_problem_versions_id_fk" FOREIGN KEY ("problem_version_id") REFERENCES "public"."problem_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_content_license_id_content_licenses_id_fk" FOREIGN KEY ("content_license_id") REFERENCES "public"."content_licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_problem_version_id_problem_versions_id_fk" FOREIGN KEY ("problem_version_id") REFERENCES "public"."problem_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_answers_attempt_question_key" ON "assessment_answers" USING btree ("attempt_id","paper_question_id");--> statement-breakpoint
CREATE INDEX "assessment_answers_execution_job_idx" ON "assessment_answers" USING btree ("execution_job_id");--> statement-breakpoint
CREATE INDEX "assessment_attempts_user_history_idx" ON "assessment_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "assessment_attempts_expiry_idx" ON "assessment_attempts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_paper_questions_paper_ordinal_key" ON "assessment_paper_questions" USING btree ("paper_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_paper_questions_paper_problem_key" ON "assessment_paper_questions" USING btree ("paper_id","problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_papers_slug_key" ON "assessment_papers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "assessment_papers_company_status_idx" ON "assessment_papers" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_key" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_key" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "editorials_problem_version_key" ON "editorials" USING btree ("problem_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_report_questions_report_ordinal_key" ON "interview_report_questions" USING btree ("report_id","ordinal");--> statement-breakpoint
CREATE INDEX "interview_reports_moderation_queue_idx" ON "interview_reports" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "interview_reports_company_status_idx" ON "interview_reports" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "moderation_decisions_report_created_idx" ON "moderation_decisions" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_company_evidence_identity_key" ON "problem_company_evidence" USING btree ("problem_id","company_id","evidence_type","role","round","year_from");--> statement-breakpoint
CREATE INDEX "problem_company_evidence_company_filter_idx" ON "problem_company_evidence" USING btree ("company_id","evidence_type","verification_status");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_examples_version_ordinal_key" ON "problem_examples" USING btree ("problem_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_language_templates_version_language_key" ON "problem_language_templates" USING btree ("problem_version_id","language");--> statement-breakpoint
CREATE INDEX "problem_language_templates_judge0_idx" ON "problem_language_templates" USING btree ("language","judge0_language_id");--> statement-breakpoint
CREATE INDEX "problem_topics_topic_problem_idx" ON "problem_topics" USING btree ("topic_id","problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_versions_problem_version_key" ON "problem_versions" USING btree ("problem_id","version");--> statement-breakpoint
CREATE INDEX "problem_versions_problem_status_idx" ON "problem_versions" USING btree ("problem_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_cases_version_ordinal_key" ON "test_cases" USING btree ("problem_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "test_cases_version_visibility_idx" ON "test_cases" USING btree ("problem_version_id","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_slug_key" ON "topics" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_name_key" ON "topics" USING btree ("name");--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_difficulty_calibration_range" CHECK ("problems"."difficulty_calibration" between -2 and 2);--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_current_version_positive" CHECK ("problems"."current_version" > 0);--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_submission_counts_coherent" CHECK ("problems"."accepted_submissions" >= 0 and "problems"."total_submissions" >= "problems"."accepted_submissions");--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_server_verification_coherent" CHECK (("run_attempts"."server_verified" and "run_attempts"."server_verified_at" is not null and "run_attempts"."provider_name" is not null)
          or (not "run_attempts"."server_verified" and "run_attempts"."server_verified_at" is null));
--> statement-breakpoint
-- Keep updated_at database-authoritative for every mutable table introduced here.
CREATE TRIGGER assessment_answers_touch_updated_at BEFORE UPDATE ON assessment_answers FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER assessment_attempts_touch_updated_at BEFORE UPDATE ON assessment_attempts FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER assessment_paper_questions_touch_updated_at BEFORE UPDATE ON assessment_paper_questions FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER assessment_papers_touch_updated_at BEFORE UPDATE ON assessment_papers FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER companies_touch_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER content_licenses_touch_updated_at BEFORE UPDATE ON content_licenses FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER editorials_touch_updated_at BEFORE UPDATE ON editorials FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_report_questions_touch_updated_at BEFORE UPDATE ON interview_report_questions FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER interview_reports_touch_updated_at BEFORE UPDATE ON interview_reports FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER problem_company_evidence_touch_updated_at BEFORE UPDATE ON problem_company_evidence FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER problem_examples_touch_updated_at BEFORE UPDATE ON problem_examples FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER problem_language_templates_touch_updated_at BEFORE UPDATE ON problem_language_templates FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER problem_versions_touch_updated_at BEFORE UPDATE ON problem_versions FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER test_cases_touch_updated_at BEFORE UPDATE ON test_cases FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER topics_touch_updated_at BEFORE UPDATE ON topics FOR EACH ROW EXECUTE FUNCTION traceloop_touch_updated_at();
--> statement-breakpoint
-- Moderation history is append-only; corrections are represented by a new decision.
CREATE TRIGGER moderation_decisions_append_only BEFORE UPDATE OR DELETE ON moderation_decisions FOR EACH ROW EXECUTE FUNCTION traceloop_reject_audit_mutation();
