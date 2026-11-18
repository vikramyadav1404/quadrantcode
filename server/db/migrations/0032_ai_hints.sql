-- AI hint coach: a new table only; nothing existing changes.
CREATE TABLE "ai_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"hint" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_hints_level_range" CHECK ("ai_hints"."level" between 1 and 3),
	CONSTRAINT "ai_hints_hint_length" CHECK (char_length("ai_hints"."hint") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "ai_hints" ADD CONSTRAINT "ai_hints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_hints" ADD CONSTRAINT "ai_hints_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_hints_user_created_idx" ON "ai_hints" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_hints_user_problem_idx" ON "ai_hints" USING btree ("user_id","problem_id","created_at");