CREATE TABLE "streak_freezes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"covered_local_date" date NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_completed_local_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_streaks_current_non_negative" CHECK ("user_streaks"."current_streak" >= 0),
	CONSTRAINT "user_streaks_longest_at_least_current" CHECK ("user_streaks"."longest_streak" >= "user_streaks"."current_streak")
);
--> statement-breakpoint
ALTER TABLE "streak_freezes" ADD CONSTRAINT "streak_freezes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_streaks" ADD CONSTRAINT "user_streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "streak_freezes_user_date_key" ON "streak_freezes" USING btree ("user_id","covered_local_date");--> statement-breakpoint
CREATE INDEX "streak_freezes_user_date_idx" ON "streak_freezes" USING btree ("user_id","covered_local_date");