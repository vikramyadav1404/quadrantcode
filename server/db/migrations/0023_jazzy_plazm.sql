CREATE TYPE "public"."test_case_coverage" AS ENUM('sample', 'empty', 'minimum', 'maximum', 'duplicates', 'adversarial', 'performance', 'typical');--> statement-breakpoint
ALTER TABLE "problem_versions" ADD COLUMN "reference_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD COLUMN "reference_validation_provider" text;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD COLUMN "reference_validation_summary" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "coverage" "test_case_coverage" DEFAULT 'typical' NOT NULL;