-- Local recovery documentation only. Never run this against production.
--
-- Dropping this CHECK re-permits `official_sample`, `verified_pyq`,
-- `candidate_reported` and `frequently_reported` on company associations —
-- that is, it re-permits asserting that a problem was really asked by a real
-- company. That is a C3 decision, not a schema cleanup.
--
-- The intended reason to run this is that a moderated review workflow now
-- exists. If you are running it to make an import pass, stop: the CHECK is the
-- backstop for exactly that case. See docs/c3-company-associations.md.
ALTER TABLE "problem_company_evidence"
  DROP CONSTRAINT IF EXISTS "problem_company_evidence_no_unreviewed_provenance";
