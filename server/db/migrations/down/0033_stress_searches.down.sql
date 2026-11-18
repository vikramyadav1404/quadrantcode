-- Local recovery documentation only. Never run this against production.
--
-- Drops every saved "find a small failing case" result. Nothing else refers to it.
DROP TABLE IF EXISTS "stress_searches";
