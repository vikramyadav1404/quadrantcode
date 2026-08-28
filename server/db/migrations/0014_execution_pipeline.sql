CREATE TYPE "public"."execution_language" AS ENUM('cpp17', 'java', 'python3', 'javascript');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."execution_verdict" AS ENUM('accepted', 'wrong_answer', 'tle', 'mle', 'runtime_error', 'compile_error', 'internal_error');--> statement-breakpoint
CREATE TABLE "execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"session_id" uuid,
	"language" "execution_language" NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"source" text NOT NULL,
	"stdin" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_jobs_source_not_empty" CHECK (length("execution_jobs"."source") > 0),
	CONSTRAINT "execution_jobs_source_within_cap" CHECK (length("execution_jobs"."source") <= 65536),
	CONSTRAINT "execution_jobs_stdin_within_cap" CHECK (("execution_jobs"."stdin" is null or length("execution_jobs"."stdin") <= 8192)),
	CONSTRAINT "execution_jobs_terminal_has_end" CHECK (
      ("execution_jobs"."status" in ('queued', 'running') and "execution_jobs"."finished_at" is null)
      or
      ("execution_jobs"."status" in ('completed', 'failed') and "execution_jobs"."finished_at" is not null)
    )
);
--> statement-breakpoint
CREATE TABLE "run_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"session_id" uuid,
	"language" "execution_language" NOT NULL,
	"verdict" "execution_verdict" NOT NULL,
	"runtime_ms" integer,
	"memory_kb" integer,
	"tests_passed" smallint,
	"tests_total" smallint,
	"stdout" text,
	"stderr" text,
	"compile_output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_attempts_measurements_non_negative" CHECK (("run_attempts"."runtime_ms" is null or "run_attempts"."runtime_ms" >= 0)
          and ("run_attempts"."memory_kb" is null or "run_attempts"."memory_kb" >= 0)),
	CONSTRAINT "run_attempts_tests_coherent" CHECK (
      ("run_attempts"."tests_passed" is null and "run_attempts"."tests_total" is null)
      or
      ("run_attempts"."tests_passed" is not null and "run_attempts"."tests_total" is not null
        and "run_attempts"."tests_passed" >= 0 and "run_attempts"."tests_passed" <= "run_attempts"."tests_total")
    )
);
--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_job_id_execution_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_jobs_user_created_idx" ON "execution_jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "execution_jobs_live_idx" ON "execution_jobs" USING btree ("user_id") WHERE "execution_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "execution_jobs_heartbeat_idx" ON "execution_jobs" USING btree ("heartbeat_at") WHERE "execution_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempts_job_key" ON "run_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "run_attempts_user_problem_idx" ON "run_attempts" USING btree ("user_id","problem_id","created_at" DESC NULLS LAST);