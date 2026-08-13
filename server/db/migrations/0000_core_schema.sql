CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."problem_source_type" AS ENUM('external_link', 'original');--> statement-breakpoint
CREATE TYPE "public"."problem_status" AS ENUM('draft', 'review', 'tested', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."problem_tag_type" AS ENUM('topic', 'pattern', 'company_style');--> statement-breakpoint
CREATE TYPE "public"."user_problem_status" AS ENUM('not_started', 'in_progress', 'solved', 'stuck', 'needs_revision');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"bio" text,
	"public_profile_enabled" boolean DEFAULT false NOT NULL,
	"target_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_number" text,
	"phone_verified_at" timestamp with time zone,
	"verification_level" smallint DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_verification_level_range" CHECK ("users"."verification_level" between 0 and 2),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verification_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" "verification_method" NOT NULL,
	"identifier" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_methods_attempts_nonneg" CHECK ("verification_methods"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "problem_tags" (
	"problem_id" uuid NOT NULL,
	"tag_type" "problem_tag_type" NOT NULL,
	"tag_value" text NOT NULL,
	CONSTRAINT "problem_tags_problem_id_tag_type_tag_value_pk" PRIMARY KEY("problem_id","tag_type","tag_value"),
	CONSTRAINT "problem_tags_company_style_suffix" CHECK (("problem_tags"."tag_type" <> 'company_style' or "problem_tags"."tag_value" like '%-style')),
	CONSTRAINT "problem_tags_value_normalised" CHECK ("problem_tags"."tag_value" = lower("problem_tags"."tag_value"))
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"source_type" "problem_source_type" NOT NULL,
	"platform" text,
	"external_url" text,
	"difficulty" "difficulty" NOT NULL,
	"estimated_minutes" integer DEFAULT 30 NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"status" "problem_status" DEFAULT 'draft' NOT NULL,
	"statement" text,
	"input_format" text,
	"output_format" text,
	"constraints_text" text,
	"examples" jsonb,
	"editorial" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problems_external_link_no_statement" CHECK ((
        "problems"."source_type" <> 'external_link'
        or (
          "problems"."external_url" is not null
          and "problems"."statement" is null
          and "problems"."input_format" is null
          and "problems"."output_format" is null
          and "problems"."constraints_text" is null
          and "problems"."examples" is null
          and "problems"."editorial" is null
        )
      )),
	CONSTRAINT "problems_original_has_no_external_url" CHECK (("problems"."source_type" <> 'original' or "problems"."external_url" is null)),
	CONSTRAINT "problems_estimated_minutes_positive" CHECK ("problems"."estimated_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "daily_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"target_problems" smallint DEFAULT 2 NOT NULL,
	"min_medium" smallint DEFAULT 0 NOT NULL,
	"reminder_time_local" time DEFAULT '20:00:00' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_goals_target_positive" CHECK ("daily_goals"."target_problems" > 0),
	CONSTRAINT "daily_goals_min_medium_within_target" CHECK ("daily_goals"."min_medium" >= 0 and "daily_goals"."min_medium" <= "daily_goals"."target_problems")
);
--> statement-breakpoint
CREATE TABLE "daily_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"target_count" smallint DEFAULT 0 NOT NULL,
	"solved_count" smallint DEFAULT 0 NOT NULL,
	"revision_count" smallint DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_sessions_counts_nonneg" CHECK (
      "daily_sessions"."target_count" >= 0 and "daily_sessions"."solved_count" >= 0 and "daily_sessions"."revision_count" >= 0
    )
);
--> statement-breakpoint
CREATE TABLE "user_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"status" "user_problem_status" DEFAULT 'not_started' NOT NULL,
	"first_solved_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"total_attempts" integer DEFAULT 0 NOT NULL,
	"best_time_seconds" integer,
	"confidence" "confidence",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_problems_total_attempts_nonneg" CHECK ("user_problems"."total_attempts" >= 0),
	CONSTRAINT "user_problems_best_time_positive" CHECK (("user_problems"."best_time_seconds" is null or "user_problems"."best_time_seconds" > 0))
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_methods" ADD CONSTRAINT "verification_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_goals" ADD CONSTRAINT "daily_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sessions" ADD CONSTRAINT "daily_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problems" ADD CONSTRAINT "user_problems_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problems" ADD CONSTRAINT "user_problems_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_key" ON "users" USING btree ("phone_number") WHERE "users"."phone_number" is not null;--> statement-breakpoint
CREATE INDEX "verification_methods_active_idx" ON "verification_methods" USING btree ("user_id","method","created_at" DESC NULLS LAST) WHERE "verification_methods"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "problem_tags_type_value_idx" ON "problem_tags" USING btree ("tag_type","tag_value","problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "problems_slug_key" ON "problems" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "problems_status_difficulty_idx" ON "problems" USING btree ("status","difficulty","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "daily_goals_user_effective_idx" ON "daily_goals" USING btree ("user_id","effective_from" DESC NULLS LAST,"active");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_goals_user_effective_key" ON "daily_goals" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_sessions_user_date_key" ON "daily_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "daily_sessions_user_date_idx" ON "daily_sessions" USING btree ("user_id","local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "user_problems_user_problem_key" ON "user_problems" USING btree ("user_id","problem_id");--> statement-breakpoint
CREATE INDEX "user_problems_user_status_idx" ON "user_problems" USING btree ("user_id","status","last_attempted_at" DESC NULLS LAST);