-- 105_integration_connections.sql
--
-- E-commerce integrations (W7): connections of a company to marketplaces,
-- shop platforms, web analytics and ad cabinets, and the facts synchronised
-- from them.
--
--   integration_connections  one row per (company, provider). Credentials are
--                            stored ONLY encrypted («v1:…», AES-256-GCM,
--                            lib/crypto/secrets.ts encryptSecret) in
--                            secret_ciphertext / refresh_ciphertext; those
--                            columns are never granted to anon/authenticated
--                            (column grants), so even a member who can read
--                            the row cannot read a secret. auth_kind 'file'
--                            is a connection without credentials: the provider
--                            has no verified live adapter and its data comes
--                            from uploaded exports (CSV/XLSX).
--   integration_facts        numbers fetched from a provider for a period
--                            (orders, revenue, returns, sessions …). One row
--                            per (company, provider, metric_key, period) —
--                            a re-sync of the same period updates the value
--                            (idempotent upsert). They feed
--                            ResolverContext.externalSignals → public.metrics
--                            with source 'external' (lib/integrations/signals.ts).
--
-- Provider keys = lib/integrations/registry.ts INTEGRATION_PROVIDER_KEYS
-- (a test keeps the CHECK and the registry in sync).
--
-- RLS: members of the company read (can_read_company … IS TRUE — NULL-safe),
-- platform staff read (is_platform_staff() IS TRUE); nobody writes through
-- PostgREST — the app writes with the service role / direct connection after
-- its own authorisation (lib/integrations/store.ts).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/105_integration_connections.sql

-- ── Connections ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider           TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'connected',
  auth_kind          TEXT        NOT NULL,
  secret_ciphertext  TEXT,
  refresh_ciphertext TEXT,
  expires_at         TIMESTAMPTZ,
  scopes             TEXT[]      NOT NULL DEFAULT '{}'::text[],
  account_label      TEXT,
  settings           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  cursor             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at       TIMESTAMPTZ,
  next_sync_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_lease_until   TIMESTAMPTZ,
  sync_lease_token   UUID,
  last_error         TEXT,
  last_error_kind    TEXT,
  error_count        INTEGER     NOT NULL DEFAULT 0,
  created_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_connections IS
  'E-commerce integration connections (105): encrypted credentials (v1:…), sync cursor and status. Secret columns are not granted to anon/authenticated.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_connections_company_provider_key') THEN
    ALTER TABLE public.integration_connections
      ADD CONSTRAINT integration_connections_company_provider_key UNIQUE (company_id, provider);
  END IF;
END $$;

-- CHECKs are (re)created so a re-run converges on the current definition.
ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_provider_check;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_provider_check
  CHECK (provider IN (
    'moysklad', 'kaspi', 'wildberries', 'ozon', 'ga4', 'yandex_metrika',
    'shopify', 'insales', 'tilda', 'bitrix_shop', 'meta_ads', 'yandex_direct', 'google_ads'
  ));

ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_status_check;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_status_check
  CHECK (status IN ('connected', 'error', 'disconnected', 'needs_reauth'));

ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_auth_kind_check;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_auth_kind_check
  CHECK (auth_kind IN ('token', 'oauth', 'basic', 'file'));

-- Only ciphertext of lib/crypto/secrets.ts is accepted: a plaintext token can never land here.
ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_secret_sealed;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_secret_sealed
  CHECK (
    (secret_ciphertext IS NULL OR secret_ciphertext ~ '^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$')
    AND (refresh_ciphertext IS NULL OR refresh_ciphertext ~ '^v1:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$')
  );

-- A disconnected connection holds no secrets; a file connection never has any;
-- a live connection always has one.
ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_secret_matches_state;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_secret_matches_state
  CHECK (
    CASE
      WHEN auth_kind = 'file' THEN secret_ciphertext IS NULL AND refresh_ciphertext IS NULL
      WHEN status = 'disconnected' THEN secret_ciphertext IS NULL AND refresh_ciphertext IS NULL
      ELSE secret_ciphertext IS NOT NULL
    END
  );

ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_text_bounds;
ALTER TABLE public.integration_connections ADD CONSTRAINT integration_connections_text_bounds
  CHECK (
    (account_label IS NULL OR length(account_label) <= 200)
    AND (last_error IS NULL OR length(last_error) <= 500)
    AND (last_error_kind IS NULL OR last_error_kind IN ('auth', 'rate_limit', 'transient', 'config', 'permanent'))
    AND error_count >= 0
    AND cardinality(scopes) <= 20
    AND jsonb_typeof(settings) = 'object'
    AND jsonb_typeof(cursor) = 'object'
    AND pg_column_size(cursor) <= 16384
    AND pg_column_size(settings) <= 4096
  );

CREATE INDEX IF NOT EXISTS integration_connections_due_idx
  ON public.integration_connections (next_sync_at)
  WHERE status IN ('connected', 'error') AND auth_kind <> 'file';

CREATE OR REPLACE FUNCTION public.integration_connections_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS integration_connections_touch ON public.integration_connections;
CREATE TRIGGER integration_connections_touch
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.integration_connections_touch();

-- ── Facts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_facts (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL,
  metric_key    TEXT        NOT NULL,
  period_start  DATE        NOT NULL,
  period_end    DATE        NOT NULL,
  value         NUMERIC     NOT NULL,
  unit          TEXT,
  source_ref    TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_facts IS
  'Facts synchronised from e-commerce integrations (105), one per (company, provider, metric_key, period); feed metrics with source external.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_facts_period_key') THEN
    ALTER TABLE public.integration_facts
      ADD CONSTRAINT integration_facts_period_key UNIQUE (company_id, provider, metric_key, period_start, period_end);
  END IF;
END $$;

ALTER TABLE public.integration_facts DROP CONSTRAINT IF EXISTS integration_facts_provider_check;
ALTER TABLE public.integration_facts ADD CONSTRAINT integration_facts_provider_check
  CHECK (provider IN (
    'moysklad', 'kaspi', 'wildberries', 'ozon', 'ga4', 'yandex_metrika',
    'shopify', 'insales', 'tilda', 'bitrix_shop', 'meta_ads', 'yandex_direct', 'google_ads'
  ));

ALTER TABLE public.integration_facts DROP CONSTRAINT IF EXISTS integration_facts_shape;
ALTER TABLE public.integration_facts ADD CONSTRAINT integration_facts_shape
  CHECK (
    metric_key ~ '^[a-z][a-z0-9_]{1,63}$'
    AND period_end >= period_start
    AND period_end - period_start <= 366
    AND (unit IS NULL OR length(unit) <= 16)
    AND (source_ref IS NULL OR length(source_ref) <= 200)
  );

CREATE INDEX IF NOT EXISTS integration_facts_company_idx
  ON public.integration_facts (company_id, period_end DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_connections_member_read ON public.integration_connections;
CREATE POLICY integration_connections_member_read ON public.integration_connections
  FOR SELECT TO authenticated
  USING (public.can_read_company(company_id) IS TRUE);

DROP POLICY IF EXISTS integration_connections_staff_read ON public.integration_connections;
CREATE POLICY integration_connections_staff_read ON public.integration_connections
  FOR SELECT TO authenticated
  USING (public.is_platform_staff() IS TRUE);

DROP POLICY IF EXISTS integration_facts_member_read ON public.integration_facts;
CREATE POLICY integration_facts_member_read ON public.integration_facts
  FOR SELECT TO authenticated
  USING (public.can_read_company(company_id) IS TRUE);

DROP POLICY IF EXISTS integration_facts_staff_read ON public.integration_facts;
CREATE POLICY integration_facts_staff_read ON public.integration_facts
  FOR SELECT TO authenticated
  USING (public.is_platform_staff() IS TRUE);

-- Grants: nothing for anon; authenticated reads only the non-secret columns;
-- writes go through the server (service role / direct connection).
REVOKE ALL ON public.integration_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integration_facts FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, company_id, provider, status, auth_kind, expires_at, scopes, account_label, settings,
  last_sync_at, next_sync_at, last_error, last_error_kind, error_count, created_by, created_at, updated_at
) ON public.integration_connections TO authenticated;
GRANT SELECT ON public.integration_facts TO authenticated;

GRANT ALL ON public.integration_connections TO service_role;
GRANT ALL ON public.integration_facts TO service_role;

REVOKE EXECUTE ON FUNCTION public.integration_connections_touch() FROM PUBLIC;
