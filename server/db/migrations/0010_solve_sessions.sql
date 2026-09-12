CREATE TYPE "public"."session_event_type" AS ENUM('session_started', 'paused', 'resumed', 'idle_autopause', 'session_completed', 'session_abandoned');--> statement-breakpoint
CREATE TYPE "public"."solve_session_status" AS ENUM('active', 'paused', 'solved', 'stuck', 'abandoned');--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" "session_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solve_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"status" "solve_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_local_date" date NOT NULL,
	"ended_local_date" date,
	"confidence" "confidence",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solve_sessions_terminal_has_end" CHECK (
      ("solve_sessions"."status" in ('active', 'paused')
        and "solve_sessions"."ended_at" is null and "solve_sessions"."ended_local_date" is null)
      or
      ("solve_sessions"."status" in ('solved', 'stuck', 'abandoned')
        and "solve_sessions"."ended_at" is not null and "solve_sessions"."ended_local_date" is not null)
    ),
	CONSTRAINT "solve_sessions_ends_after_start" CHECK (
      ("solve_sessions"."ended_at" is null or "solve_sessions"."ended_at" >= "solve_sessions"."started_at")
    ),
	CONSTRAINT "solve_sessions_heartbeat_after_start" CHECK (
      "solve_sessions"."last_heartbeat_at" >= "solve_sessions"."started_at"
    )
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD CONSTRAINT "solve_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_sessions" ADD CONSTRAINT "solve_sessions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_session_occurred_idx" ON "session_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "solve_sessions_one_live_per_user" ON "solve_sessions" USING btree ("user_id") WHERE "solve_sessions"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "solve_sessions_user_problem_idx" ON "solve_sessions" USING btree ("user_id","problem_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "solve_sessions_live_heartbeat_idx" ON "solve_sessions" USING btree ("last_heartbeat_at") WHERE "solve_sessions"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "solve_sessions_user_ended_idx" ON "solve_sessions" USING btree ("user_id","ended_local_date" DESC NULLS LAST);