-- Local recovery documentation only. Never run this against production.
--
-- Drops every hint users were shown. Solves already scheduled keep the dates the
-- hints influenced.
DROP TABLE IF EXISTS "ai_hints";
