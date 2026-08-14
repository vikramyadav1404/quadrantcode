CREATE TYPE "public"."target_role" AS ENUM('sde_intern', 'sde_1', 'quant', 'hft', 'other');--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "target_role" SET DATA TYPE "public"."target_role" USING "target_role"::"public"."target_role";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_bio_length" CHECK ("user_profiles"."bio" is null or char_length("user_profiles"."bio") <= 280);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_display_name_length" CHECK ("user_profiles"."display_name" is null
          or char_length("user_profiles"."display_name") between 2 and 40);