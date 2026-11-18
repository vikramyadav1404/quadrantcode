-- "Find a small failing case": a new table only; nothing existing changes.
CREATE TABLE "stress_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"runs" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "stress_searches_jobId_unique" UNIQUE("job_id"),
	CONSTRAINT "stress_searches_status_known" CHECK ("stress_searches"."status" in ('running', 'done')),
	CONSTRAINT "stress_searches_done_has_result" CHECK (("stress_searches"."status" = 'done') = ("stress_searches"."result" is not null and "stress_searches"."finished_at" is not null)),
	CONSTRAINT "stress_searches_runs_range" CHECK ("stress_searches"."runs" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "stress_searches" ADD CONSTRAINT "stress_searches_job_id_execution_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stress_searches" ADD CONSTRAINT "stress_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stress_searches_user_created_idx" ON "stress_searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "stress_searches_created_idx" ON "stress_searches" USING btree ("created_at");