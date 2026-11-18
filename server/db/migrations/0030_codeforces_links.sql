-- Codeforces sync: one handle per user. A new table only; nothing existing changes.
CREATE TABLE "codeforces_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codeforces_links_handle_format" CHECK (handle ~ '^[A-Za-z0-9_.-]{3,24}$')
);
--> statement-breakpoint
ALTER TABLE "codeforces_links" ADD CONSTRAINT "codeforces_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;