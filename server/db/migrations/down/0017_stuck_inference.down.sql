-- Down migration for 0017_stuck_inference.
--
-- DESTROYS DATA, and asymmetrically. Two different things are lost:
--
--   1. Every INFERRED stuck point, because restoring `category NOT NULL`
--      requires deleting the rows that have no category — which is exactly the
--      inferred ones. They are re-derivable from events and snapshots by
--      re-running the inference, so this is recoverable work rather than lost
--      history.
--
--   2. Every CONFIRMATION and DISMISSAL a user made against an inference.
--      That is NOT re-derivable. It is the user's own judgement, and nothing
--      else in the database records it.
--
-- The second one is the reason this file leads with a deletion rather than
-- quietly relying on the NOT NULL to fail. If this is ever run against real
-- data, the honest thing is to export `stuck_points WHERE source = 'inferred'`
-- first — a re-run of the inference will regenerate the regions but will put
-- every one of them back at 'inferred', asking the user again.

DELETE FROM "stuck_points" WHERE "source" = 'inferred';
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP CONSTRAINT IF EXISTS "stuck_points_line_range_coherent";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP CONSTRAINT IF EXISTS "stuck_points_user_has_category";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "updated_at";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "evidence";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "ended_seconds";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "started_seconds";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "line_end";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "line_start";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "confidence";
--> statement-breakpoint
ALTER TABLE "stuck_points" DROP COLUMN IF EXISTS "status";
--> statement-breakpoint
ALTER TABLE "stuck_points" ALTER COLUMN "category" SET NOT NULL;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."stuck_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."stuck_confidence";
