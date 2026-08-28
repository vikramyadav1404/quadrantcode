CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_action_not_empty" CHECK (length("audit_logs"."action") > 0),
	CONSTRAINT "audit_logs_target_not_empty" CHECK (length("audit_logs"."target") > 0)
);
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target");--> statement-breakpoint
-- F4.6 · audit logs are immutable, at the database.
--
-- Same mechanism as `session_events` (F3.2, migration 0015) and a stricter
-- policy: that table allows deletion behind a declared flag because a user may
-- erase their own history. **This one has no escape hatch at all.**
--
-- An audit log exists precisely so that the people with power over other
-- people's data cannot quietly erase what they did — a purge flag would hand
-- them the eraser. `actor_id` deliberately has no foreign key for the same
-- reason: deleting an admin account must not cascade away everything that
-- admin ever did.
CREATE OR REPLACE FUNCTION traceloop_reject_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a correcting entry. Audit history is never edited.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION traceloop_reject_audit_mutation();
