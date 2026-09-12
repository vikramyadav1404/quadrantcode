-- F3.2 · the solve timeline.
--
-- `ALTER TYPE ... ADD VALUE` is written IF NOT EXISTS deliberately. The down
-- migration cannot remove enum values — Postgres has no `DROP VALUE` — so they
-- survive a rollback, and a second `up` would fail on a plain ADD VALUE. The
-- up -> down -> up test is what would catch that, and this is the fix rather
-- than the test being loosened.
CREATE TYPE "public"."snapshot_trigger" AS ENUM('run_attempt', 'stuck_marker', 'interval');--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'statement_viewed';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'first_keystroke';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'code_snapshot';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'run_attempted';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'run_failed';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'run_passed';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'idle_started';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE IF NOT EXISTS 'idle_ended';--> statement-breakpoint
CREATE TABLE "code_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"language" "execution_language" NOT NULL,
	"is_full" boolean NOT NULL,
	"content" text NOT NULL,
	"source_bytes" integer NOT NULL,
	"trigger" "snapshot_trigger" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_snapshots_sequence_non_negative" CHECK ("code_snapshots"."sequence" >= 0),
	CONSTRAINT "code_snapshots_first_is_full" CHECK ("code_snapshots"."sequence" > 0 or "code_snapshots"."is_full"),
	CONSTRAINT "code_snapshots_content_within_cap" CHECK (length("code_snapshots"."content") <= 65536),
	CONSTRAINT "code_snapshots_source_bytes_non_negative" CHECK ("code_snapshots"."source_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "code_snapshots" ADD CONSTRAINT "code_snapshots_session_id_solve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."solve_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_snapshots" ADD CONSTRAINT "code_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_snapshots_session_sequence_key" ON "code_snapshots" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "code_snapshots_user_created_idx" ON "code_snapshots" USING btree ("user_id","created_at");--> statement-breakpoint
-- F3.2 · the session log becomes append-only, at the database.
--
-- Criterion #1 is that an UPDATE against `session_events` is rejected at the
-- DATABASE level. A service that only ever inserts is a promise about today's
-- code; this is a promise about the table. A psql session, a future migration
-- and a bug all meet the same refusal.
--
-- ## Why DELETE is refused too, and how deletion still happens
--
-- Criterion #4 requires "delete my solve history" to leave no event rows, and
-- `solve_sessions` cascades to this table. Both of those are DELETEs.
--
-- So the trigger refuses unless a transaction-local flag is set, and exactly
-- one module sets it: `server/services/timeline/retention.ts`. That is not
-- enforcement by convention — without the flag nothing can remove a row, by any
-- route. Setting it is a deliberate statement inside a transaction whose whole
-- purpose is to erase data the user asked to erase.
--
-- `current_setting(..., true)` returns NULL rather than raising when the flag
-- was never set, which is the normal case on every other transaction.
CREATE OR REPLACE FUNCTION quadrantcode_reject_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF coalesce(current_setting('quadrantcode.purging', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'session_events is append-only (attempted %)', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a correcting event. To erase history, use the retention service.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER session_events_append_only
BEFORE UPDATE OR DELETE ON session_events
FOR EACH ROW EXECUTE FUNCTION quadrantcode_reject_event_mutation();
