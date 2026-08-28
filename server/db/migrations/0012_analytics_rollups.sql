CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"solved_count" smallint DEFAULT 0 NOT NULL,
	"stuck_count" smallint DEFAULT 0 NOT NULL,
	"abandoned_count" smallint DEFAULT 0 NOT NULL,
	"session_count" smallint DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"easy_solved" smallint DEFAULT 0 NOT NULL,
	"medium_solved" smallint DEFAULT 0 NOT NULL,
	"hard_solved" smallint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_counts_non_negative" CHECK ("analytics_daily"."solved_count" >= 0 and "analytics_daily"."stuck_count" >= 0
          and "analytics_daily"."abandoned_count" >= 0 and "analytics_daily"."session_count" >= 0
          and "analytics_daily"."active_seconds" >= 0),
	CONSTRAINT "analytics_daily_outcomes_within_sessions" CHECK ("analytics_daily"."solved_count" + "analytics_daily"."stuck_count" + "analytics_daily"."abandoned_count"
          <= "analytics_daily"."session_count"),
	CONSTRAINT "analytics_daily_difficulty_within_solved" CHECK ("analytics_daily"."easy_solved" + "analytics_daily"."medium_solved" + "analytics_daily"."hard_solved"
          <= "analytics_daily"."solved_count")
);
--> statement-breakpoint
CREATE TABLE "analytics_stuck_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"category" text NOT NULL,
	"marked_count" smallint DEFAULT 0 NOT NULL,
	"reflected_count" smallint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_stuck_daily_counts_non_negative" CHECK ("analytics_stuck_daily"."marked_count" >= 0 and "analytics_stuck_daily"."reflected_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_topic_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"topic" text NOT NULL,
	"solved_count" smallint DEFAULT 0 NOT NULL,
	"stuck_count" smallint DEFAULT 0 NOT NULL,
	"session_count" smallint DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"estimated_seconds" integer DEFAULT 0 NOT NULL,
	"confidence_sum" smallint DEFAULT 0 NOT NULL,
	"confidence_count" smallint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_topic_daily_counts_non_negative" CHECK ("analytics_topic_daily"."solved_count" >= 0 and "analytics_topic_daily"."stuck_count" >= 0
          and "analytics_topic_daily"."session_count" >= 0 and "analytics_topic_daily"."active_seconds" >= 0
          and "analytics_topic_daily"."estimated_seconds" >= 0 and "analytics_topic_daily"."confidence_count" >= 0),
	CONSTRAINT "analytics_topic_daily_outcomes_within_sessions" CHECK ("analytics_topic_daily"."solved_count" + "analytics_topic_daily"."stuck_count" <= "analytics_topic_daily"."session_count"),
	CONSTRAINT "analytics_topic_daily_confidence_range" CHECK ("analytics_topic_daily"."confidence_sum" >= "analytics_topic_daily"."confidence_count"
          and "analytics_topic_daily"."confidence_sum" <= 3 * "analytics_topic_daily"."confidence_count")
);
--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_stuck_daily" ADD CONSTRAINT "analytics_stuck_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_topic_daily" ADD CONSTRAINT "analytics_topic_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_user_date_key" ON "analytics_daily" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "analytics_daily_user_date_idx" ON "analytics_daily" USING btree ("user_id","local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_stuck_daily_key" ON "analytics_stuck_daily" USING btree ("user_id","local_date","category");--> statement-breakpoint
CREATE INDEX "analytics_stuck_daily_user_date_idx" ON "analytics_stuck_daily" USING btree ("user_id","local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_topic_daily_key" ON "analytics_topic_daily" USING btree ("user_id","local_date","topic");--> statement-breakpoint
CREATE INDEX "analytics_topic_daily_user_date_idx" ON "analytics_topic_daily" USING btree ("user_id","local_date" DESC NULLS LAST);