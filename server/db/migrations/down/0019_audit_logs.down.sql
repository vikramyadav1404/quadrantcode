-- Down migration for 0019_audit_logs.
--
-- DESTROYS THE AUDIT TRAIL, which is the one thing this table exists to make
-- impossible from inside the application. That it is possible from a migration
-- is a real gap, and naming it here is better than leaving it to be discovered:
-- anyone who can run migrations can erase the record of what admins did.
--
-- If that matters for a deployment, the answer is a least-privilege database
-- role for the application and a separate one for migrations — which F4.8's
-- infrastructure section covers. Dump this table before rolling back.
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
--> statement-breakpoint
DROP FUNCTION IF EXISTS traceloop_reject_audit_mutation();
--> statement-breakpoint
DROP TABLE IF EXISTS "audit_logs";
