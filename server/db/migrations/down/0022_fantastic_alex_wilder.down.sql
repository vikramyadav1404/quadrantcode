ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_active_question_id_assessment_paper_questions_id_fk;
ALTER TABLE assessment_attempts DROP COLUMN IF EXISTS last_interaction_at;
ALTER TABLE assessment_attempts DROP COLUMN IF EXISTS active_question_id;
