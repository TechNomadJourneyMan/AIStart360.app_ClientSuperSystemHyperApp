-- 094_ai_providers_credentials.sql
--
-- Multi-provider LLM management (docs/platform/05-agents.md, §8.1). The owner
-- adds OpenAI-compatible providers and their API keys from the admin panel or
-- the Telegram bot (lib/ai/providers/service.ts) and chooses which model serves
-- each purpose:
--
--   ai_providers    an API endpoint: OpenRouter or any OpenAI-compatible base
--                   URL, with a configurable path per capability (nothing about
--                   a provider is hard-coded except the seeded rows below)
--   ai_credentials  API keys of a provider, AES-256-GCM encrypted by the server
--                   (lib/crypto/secrets.ts, SECRETS_ENCRYPTION_KEY). Only the
--                   last 4 characters are kept in clear (secret_hint).
--   ai_models       a model id a provider serves for one capability
--                   (chat | embeddings | rerank | ocr), its prices and the key
--                   it uses (NULL = the provider's first enabled key)
--   ai_routes       capability (+ tier for chat: light | standard | premium)
--                   → model. No route = the built-in behaviour (OpenRouter with
--                   OPENROUTER_API_KEY and the env/default tier models).
--   ai_budgets      single row: platform and per-company daily USD budgets
--                   editable at runtime (NULL = env AGENT_*_DAILY_BUDGET_USD).
--                   The per-provider daily budget is ai_providers.daily_budget_usd.
--
-- Also: ai_usage_ledger.provider_key / agent_runs.provider_key (which provider
-- served the call; NULL for rows written before 094), cost_source 'model_price'
-- (cost computed from ai_models prices when the provider reports none).
--
-- Internal tables: RLS on, no grants to anon/authenticated — only the server
-- (service role / direct connection) reads them.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/094_ai_providers_credentials.sql

CREATE TABLE IF NOT EXISTS public.ai_providers (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                       TEXT        NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name                      TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind                      TEXT        NOT NULL CHECK (kind IN ('openrouter', 'openai_compatible')),
  base_url                  TEXT        NOT NULL CHECK (base_url ~ '^https?://' AND length(base_url) <= 300),
  chat_path                 TEXT        NOT NULL DEFAULT '/chat/completions',
  embeddings_path           TEXT        NOT NULL DEFAULT '/embeddings',
  rerank_path               TEXT,
  ocr_mode                  TEXT        CHECK (ocr_mode IS NULL OR ocr_mode IN ('chat_vision')),
  extra_headers             JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- non-secret only
  supports_response_format  BOOLEAN     NOT NULL DEFAULT TRUE,
  enabled                   BOOLEAN     NOT NULL DEFAULT TRUE,
  daily_budget_usd          NUMERIC(12,2) CHECK (daily_budget_usd IS NULL OR daily_budget_usd >= 0),
  privacy_note              TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_providers IS
  'LLM API providers (094). Keys live in ai_credentials; routing in ai_routes.';

CREATE TABLE IF NOT EXISTS public.ai_credentials (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID        NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  label              TEXT        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  secret_ciphertext  TEXT        NOT NULL CHECK (secret_ciphertext LIKE 'v1:%'),
  secret_hint        TEXT        CHECK (secret_hint IS NULL OR length(secret_hint) <= 4),
  enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
  last_verified_at   TIMESTAMPTZ,
  last_verify_ok     BOOLEAN,
  last_verify_error  TEXT        CHECK (last_verify_error IS NULL OR length(last_verify_error) <= 500),
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_credentials_provider_idx ON public.ai_credentials (provider_id, created_at);
COMMENT ON TABLE public.ai_credentials IS
  'Encrypted API keys of ai_providers (094). Never readable by API roles; plaintext never stored.';

CREATE TABLE IF NOT EXISTS public.ai_models (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID        NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  credential_id       UUID        REFERENCES public.ai_credentials(id) ON DELETE SET NULL,
  model_id            TEXT        NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  capability          TEXT        NOT NULL CHECK (capability IN ('chat', 'embeddings', 'rerank', 'ocr')),
  label               TEXT,
  price_in_per_mtok   NUMERIC(12,4) CHECK (price_in_per_mtok IS NULL OR price_in_per_mtok >= 0),
  price_out_per_mtok  NUMERIC(12,4) CHECK (price_out_per_mtok IS NULL OR price_out_per_mtok >= 0),
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_id, capability)
);
CREATE INDEX IF NOT EXISTS ai_models_model_idx ON public.ai_models (model_id, capability);

CREATE TABLE IF NOT EXISTS public.ai_routes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability  TEXT        NOT NULL CHECK (capability IN ('chat', 'embeddings', 'rerank', 'ocr')),
  tier        TEXT        CHECK (tier IS NULL OR tier IN ('light', 'standard', 'premium')),
  model_id    UUID        NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- chat is routed per tier; the other capabilities have exactly one route.
  CHECK ((capability = 'chat') = (tier IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_routes_capability_tier_key
  ON public.ai_routes (capability, coalesce(tier, ''));

CREATE TABLE IF NOT EXISTS public.ai_budgets (
  id                 SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_daily_usd NUMERIC(12,2) CHECK (platform_daily_usd IS NULL OR platform_daily_usd >= 0),
  company_daily_usd  NUMERIC(12,2) CHECK (company_daily_usd IS NULL OR company_daily_usd >= 0),
  updated_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_budgets IS
  'Runtime-editable daily AI budgets (094). NULL = env AGENT_PLATFORM/COMPANY_DAILY_BUDGET_USD.';

-- Which provider served a call (NULL for rows written before 094).
ALTER TABLE public.ai_usage_ledger ADD COLUMN IF NOT EXISTS provider_key TEXT;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS provider_key TEXT;
CREATE INDEX IF NOT EXISTS ai_usage_ledger_provider_idx
  ON public.ai_usage_ledger (provider_key, created_at DESC) WHERE provider_key IS NOT NULL;

-- cost computed from ai_models prices (provider reported none).
ALTER TABLE public.ai_usage_ledger DROP CONSTRAINT IF EXISTS ai_usage_ledger_cost_source_check;
ALTER TABLE public.ai_usage_ledger ADD CONSTRAINT ai_usage_ledger_cost_source_check
  CHECK (cost_source IN ('provider', 'model_price', 'estimate'));

-- Seed: the built-in OpenRouter and the owner's Alem Plus endpoint. Only facts
-- verified from the owner's spec are seeded (Alem: POST /v1/chat/completions,
-- Bearer key, model "alemllm"). No keys: the owner enters them.
INSERT INTO public.ai_providers (key, name, kind, base_url, chat_path, embeddings_path, privacy_note, created_by)
VALUES
  ('openrouter', 'OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1', '/chat/completions', '/embeddings',
   'provider.data_collection=deny (AI_PRIVACY_MODE) применяется к каждому вызову', 'migration:094'),
  ('alem', 'Alem Plus', 'openai_compatible', 'https://llm.alem.ai/v1', '/chat/completions', '/embeddings',
   'Режим приватности определяется договором с провайдером; поля OpenRouter не отправляются', 'migration:094')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ai_models (provider_id, model_id, capability, label)
SELECT p.id, 'alemllm', 'chat', 'Alem LLM'
FROM public.ai_providers p WHERE p.key = 'alem'
ON CONFLICT (provider_id, model_id, capability) DO NOTHING;

INSERT INTO public.ai_budgets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_providers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_routes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budgets     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_providers, public.ai_credentials, public.ai_models, public.ai_routes, public.ai_budgets
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
