-- Local recovery documentation only. Never run this against production.
--
-- Drops every user's connected Codeforces handle and last-sync summary. The
-- problems a sync already imported stay tracked; only the connection is lost.
DROP TABLE IF EXISTS "codeforces_links";
