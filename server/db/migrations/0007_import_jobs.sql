CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'running', 'succeeded', 'partial', 'failed', 'stalled');--> statement-breakpoint
CREATE TYPE "public"."import_row_outcome" AS ENUM('created', 'linked', 'duplicate', 'invalid');--> statement-breakpoint
CREATE TABLE "import_job_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"outcome" "import_row_outcome" NOT NULL,
	"problem_id" uuid,
	"raw_row" jsonb,
	"error" text,
	"error_field" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_job_rows_row_number_positive" CHECK ("import_job_rows"."row_number" > 0),
	CONSTRAINT "import_job_rows_invalid_has_error" CHECK (("import_job_rows"."outcome" <> 'invalid') = ("import_job_rows"."error" is null))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"filename" text NOT NULL,
	"content_hash" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_processed_within_total" CHECK ("import_jobs"."processed_rows" >= 0 and "import_jobs"."processed_rows" <= "import_jobs"."total_rows"),
	CONSTRAINT "import_jobs_total_rows_non_negative" CHECK ("import_jobs"."total_rows" >= 0)
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "external_url_normalised" text;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_job_rows_job_row_key" ON "import_job_rows" USING btree ("job_id","row_number");--> statement-breakpoint
CREATE INDEX "import_job_rows_job_invalid_idx" ON "import_job_rows" USING btree ("job_id","row_number") WHERE "import_job_rows"."outcome" = 'invalid';--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_user_content_key" ON "import_jobs" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "import_jobs_user_recent_idx" ON "import_jobs" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_running_heartbeat_idx" ON "import_jobs" USING btree ("heartbeat_at") WHERE "import_jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "problems_external_url_normalised_key" ON "problems" USING btree ("external_url_normalised") WHERE "problems"."external_url_normalised" is not null and "problems"."status" <> 'archived';