-- Reverses 0003_problem_search.sql
DROP INDEX IF EXISTS problems_search_vector_idx;
ALTER TABLE problems DROP COLUMN IF EXISTS search_vector;
