-- Down migration for 0015_solve_timeline.
--
-- THIS DESTROYS USER DATA. `code_snapshots` holds the only copy of the code a
-- user wrote during a session — the editor's localStorage draft is per browser
-- and holds only the latest version, not the history. Dump before rolling back
-- if the data matters.
--
-- ## The enum values do NOT come back out
--
-- Postgres has no `ALTER TYPE ... DROP VALUE`. Removing the eight values this
-- migration added would mean recreating `session_event_type` and rewriting
-- every column that uses it — a rewrite of `session_events` in a down
-- migration, which is a larger and riskier operation than the thing being
-- undone.
--
-- So they stay, and this file says so rather than leaving a reader to discover
-- that `down` was not symmetric. The cost of leaving them is nil: an enum value
-- nothing writes is inert.
--
-- The up migration was edited to say `ADD VALUE IF NOT EXISTS` for this exact
-- reason: without it, the second `up` in an up -> down -> up cycle fails on a
-- value that the down could not remove.

DROP TRIGGER IF EXISTS session_events_append_only ON session_events;
--> statement-breakpoint
DROP FUNCTION IF EXISTS traceloop_reject_event_mutation();
--> statement-breakpoint
DROP TABLE IF EXISTS "code_snapshots";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."snapshot_trigger";
