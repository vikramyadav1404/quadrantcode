CREATE TYPE "public"."mistake_trend" AS ENUM('improving', 'flat', 'worsening');--> statement-breakpoint
CREATE TABLE "mistake_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "mistake_category" NOT NULL,
	"topic" text,
	"occurrences" integer NOT NULL,
	"confirmed_stuck_count" integer DEFAULT 0 NOT NULL,
	"recent_count" integer NOT NULL,
	"earlier_count" integer NOT NULL,
	"trend" "mistake_trend" NOT NULL,
	"first_seen_on" timestamp with time zone NOT NULL,
	"last_seen_on" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mistake_patterns_counts_non_negative" CHECK ("mistake_patterns"."occurrences" >= 0
      and "mistake_patterns"."recent_count" >= 0 and "mistake_patterns"."earlier_count" >= 0),
	CONSTRAINT "mistake_patterns_windows_within_total" CHECK ("mistake_patterns"."recent_count" + "mistake_patterns"."earlier_count" <= "mistake_patterns"."occurrences"),
	CONSTRAINT "mistake_patterns_seen_order" CHECK ("mistake_patterns"."last_seen_on" >= "mistake_patterns"."first_seen_on")
);
--> statement-breakpoint
CREATE TABLE "mistake_warnings_shown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "mistake_category" NOT NULL,
	"shown_local_date" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mistake_patterns" ADD CONSTRAINT "mistake_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_warnings_shown" ADD CONSTRAINT "mistake_warnings_shown_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_patterns_grain" ON "mistake_patterns" USING btree ("user_id","category","topic") WHERE "mistake_patterns"."topic" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_patterns_grain_untagged" ON "mistake_patterns" USING btree ("user_id","category") WHERE "mistake_patterns"."topic" is null;--> statement-breakpoint
CREATE INDEX "mistake_patterns_user_occurrences_idx" ON "mistake_patterns" USING btree ("user_id","occurrences" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_warnings_once_per_day" ON "mistake_warnings_shown" USING btree ("user_id","category","shown_local_date");