-- 127_point_b_saved_whatif.sql
--
-- Point B, the «Что если» lab (docs/superpowers/specs/2026-10-18-point-b-design.md §9.5, §10;
-- plan docs/superpowers/plans/2026-10-18-point-b-phase4-whatif.md, task 1):
--
--   pb_saved_scenarios  the what-if scenarios a client chose to SAVE. A what-if never changes the plan:
--                       the calculation itself writes nothing, only the explicit «Сохранить сценарий» does.
--
--   name        1..80 characters (profanity is filtered by the application).
--   note        the client's comment, up to 500 characters.
--   changes     the parameters as the client set them: an ARRAY of changes
--               ([{ "kind": "avg_check", "pct": 10 }, …]); lib/point-b/model/whatif.ts validates them.
--   summary     the key deltas and the data level, calculated by the SERVER when saving (a summary sent
--               by the client is ignored).
--   model_version  the model version the summary was calculated with.
--   proposed_at / proposal_message_id  the client proposed the scenario to the expert (a message in the
--               «Сообщения» thread); the expert changes the plan himself.
--
-- The limit of 20 scenarios per company is checked by the application, not by the database.
--
-- RLS: written by the server only (service role). A signed-in user may SELECT only HIS OWN rows
-- (user_id = auth.uid()); staff read through the server. Anon has nothing; no INSERT / UPDATE grants
-- to authenticated.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/127_point_b_saved_whatif.sql
-- only at the push to main (the product owner's go-ahead is given).

CREATE TABLE IF NOT EXISTS public.pb_saved_scenarios (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  note                TEXT        CHECK (note IS NULL OR length(note) <= 500),
  changes             JSONB       NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND pg_column_size(changes) <= 16384),
  summary             JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object' AND pg_column_size(summary) <= 16384),
  model_version       TEXT        NOT NULL,
  proposed_at         TIMESTAMPTZ,
  proposal_message_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The list of a company, the newest first.
CREATE INDEX IF NOT EXISTS pb_saved_scenarios_company_created_idx
  ON public.pb_saved_scenarios (company_id, created_at DESC);

DROP TRIGGER IF EXISTS pb_saved_scenarios_updated_at ON public.pb_saved_scenarios;
CREATE TRIGGER pb_saved_scenarios_updated_at
  BEFORE UPDATE ON public.pb_saved_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pb_saved_scenarios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pb_saved_scenarios FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.pb_saved_scenarios FROM authenticated;
GRANT SELECT ON public.pb_saved_scenarios TO authenticated;
GRANT ALL ON public.pb_saved_scenarios TO service_role;

DROP POLICY IF EXISTS pb_saved_scenarios_owner_read ON public.pb_saved_scenarios;
CREATE POLICY pb_saved_scenarios_owner_read ON public.pb_saved_scenarios FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
