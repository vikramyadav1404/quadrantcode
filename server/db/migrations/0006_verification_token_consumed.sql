ALTER TABLE "auth_verification_tokens" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_verification_tokens" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_verification_tokens_created_idx" ON "auth_verification_tokens" USING btree ("created_at");