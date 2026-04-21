-- Allow step=0 in survey_answers for non-stepper intake flows (e.g. medical
-- onboarding, which is a single-screen form, not a 12-step wizard).
-- Previously `step BETWEEN 1 AND 12` rejected medical submissions with
-- "failed to save answers" (PostgreSQL error 23514 CHECK violation).

ALTER TABLE public.survey_answers DROP CONSTRAINT IF EXISTS survey_answers_step_check;
ALTER TABLE public.survey_answers ADD  CONSTRAINT survey_answers_step_check CHECK (step BETWEEN 0 AND 12);
