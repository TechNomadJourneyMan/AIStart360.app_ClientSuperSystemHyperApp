-- 107_ai_models_discovery.sql
--
-- AI providers, part A1 (docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md):
-- model discovery, automatic routing with failover, speech-to-text.
--
--   ai_models.capability   + 'transcribe' (OpenAI-compatible POST /audio/transcriptions)
--   ai_routes.capability   + 'transcribe' (no tier, like embeddings/rerank/ocr)
--   ai_models.source       'manual' (entered by the owner) | 'discovered' (GET /models
--                          with a key, lib/ai/providers/discovery.ts). Discovery never
--                          changes manual rows, except binding a key to a manual row
--                          without one when exactly one key of the provider serves it.
--   ai_models.discovered_at        last time a key listed the model
--   ai_models.supports_vision      image input (NULL = unknown)
--   ai_models.supports_tools       OpenAI tools / tool_calls (NULL = unknown → tried)
--   ai_models.tier_hint            light | standard | premium (NULL = any): which chat
--                                  tier the automatic routing may use the model for first
--   ai_credentials.discovered_models   model ids GET /models returned for this key
--                                      (NULL = never discovered)
--   ai_credentials.models_discovered_at / discovery_error   outcome of the last discovery
--
-- Model health (circuit breaker) is in memory only — no table.
--
-- Internal tables: RLS stays on, no grants to anon/authenticated (as in 094).
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/107_ai_models_discovery.sql

-- capability: + transcribe
ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_capability_check;
ALTER TABLE public.ai_models ADD CONSTRAINT ai_models_capability_check
  CHECK (capability IN ('chat', 'embeddings', 'rerank', 'ocr', 'transcribe'));

ALTER TABLE public.ai_routes DROP CONSTRAINT IF EXISTS ai_routes_capability_check;
ALTER TABLE public.ai_routes ADD CONSTRAINT ai_routes_capability_check
  CHECK (capability IN ('chat', 'embeddings', 'rerank', 'ocr', 'transcribe'));

-- discovery / routing metadata of a model
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS source          TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS discovered_at   TIMESTAMPTZ;
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS supports_vision BOOLEAN;
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS supports_tools  BOOLEAN;
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS tier_hint       TEXT;

ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_source_check;
ALTER TABLE public.ai_models ADD CONSTRAINT ai_models_source_check
  CHECK (source IN ('manual', 'discovered'));
ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_tier_hint_check;
ALTER TABLE public.ai_models ADD CONSTRAINT ai_models_tier_hint_check
  CHECK (tier_hint IS NULL OR tier_hint IN ('light', 'standard', 'premium'));

CREATE INDEX IF NOT EXISTS ai_models_capability_idx ON public.ai_models (capability, enabled);

-- what each key serves (GET /models with that key)
ALTER TABLE public.ai_credentials ADD COLUMN IF NOT EXISTS discovered_models    TEXT[];
ALTER TABLE public.ai_credentials ADD COLUMN IF NOT EXISTS models_discovered_at TIMESTAMPTZ;
ALTER TABLE public.ai_credentials ADD COLUMN IF NOT EXISTS discovery_error      TEXT;

ALTER TABLE public.ai_credentials DROP CONSTRAINT IF EXISTS ai_credentials_discovery_error_check;
ALTER TABLE public.ai_credentials ADD CONSTRAINT ai_credentials_discovery_error_check
  CHECK (discovery_error IS NULL OR length(discovery_error) <= 500);
ALTER TABLE public.ai_credentials DROP CONSTRAINT IF EXISTS ai_credentials_discovered_models_check;
ALTER TABLE public.ai_credentials ADD CONSTRAINT ai_credentials_discovered_models_check
  CHECK (discovered_models IS NULL OR cardinality(discovered_models) <= 500);

COMMENT ON COLUMN public.ai_models.source IS
  'manual = entered by the owner; discovered = found by GET /models (107). Discovery never edits manual rows.';
COMMENT ON COLUMN public.ai_credentials.discovered_models IS
  'Model ids GET /models returned for this key at models_discovered_at (107); NULL = never discovered.';

-- Same access model as 094: server only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.ai_models, public.ai_routes, public.ai_credentials FROM anon, authenticated;
  END IF;
END $$;
ALTER TABLE public.ai_models      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_routes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credentials ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
