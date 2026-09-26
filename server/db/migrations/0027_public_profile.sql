ALTER TABLE "user_profiles" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "public_show_streak" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "public_show_longest_streak" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "public_show_total_solved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "public_show_topics" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_handle_key" ON "user_profiles" USING btree ("handle") WHERE "user_profiles"."handle" is not null;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_handle_format" CHECK ("user_profiles"."handle" is null or "user_profiles"."handle" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');