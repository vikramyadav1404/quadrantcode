-- Reverses 0005_profile_fields.sql
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_display_name_length;
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_bio_length;
ALTER TABLE user_profiles ALTER COLUMN target_role TYPE text USING target_role::text;
DROP TYPE IF EXISTS target_role;
