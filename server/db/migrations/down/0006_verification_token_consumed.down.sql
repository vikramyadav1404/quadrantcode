-- Reverses 0006_verification_token_consumed.sql
DROP INDEX IF EXISTS auth_verification_tokens_created_idx;
ALTER TABLE auth_verification_tokens DROP COLUMN IF EXISTS created_at;
ALTER TABLE auth_verification_tokens DROP COLUMN IF EXISTS consumed_at;
