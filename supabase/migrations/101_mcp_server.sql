-- 101_mcp_server.sql
--
-- MCP server of the platform (app/api/mcp, lib/mcp): read-only tools for
-- staff and experts, called from Claude Code / Claude Desktop and other MCP
-- clients. Owner decision «Оба»: stage 1 personal access tokens, stage 2
-- OAuth 2.1 (MCP Authorization, revision 2026-07-28:
-- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
--
--   mcp_tokens           personal access tokens (PAT) created in GIGA, the
--                        expert portal or the admin bot. Only the SHA-256 of
--                        the token is stored; the token is shown once.
--   oauth_clients        clients registered through Dynamic Client
--                        Registration (RFC 7591). Public clients (PKCE, no
--                        secret) or confidential ones (secret hash only).
--   oauth_auth_requests  a validated /authorize request waiting for the
--                        person's consent (10 minutes, single use).
--   oauth_auth_codes     authorization codes: hash only, PKCE S256 challenge,
--                        exact redirect_uri, 60 s – 10 min lifetime, single use.
--   oauth_tokens         access/refresh pairs: hashes only, bound to the MCP
--                        resource URL (RFC 8707), rotation chain (family_id,
--                        rotated_from) for refresh-token reuse detection.
--   mcp_audit            every MCP call: who, which tool, an argument summary
--                        WITHOUT personal data, result status and latency.
--
-- Scopes are NOT stored as permissions: each call re-derives the allowed
-- scopes from the caller's CURRENT role (staff_roles / profiles, see
-- lib/mcp/scopes.ts), so a revoked staff member loses access at once.
--
-- Server-only tables: RLS on, no policies, ALL revoked from PUBLIC / anon /
-- authenticated. People read their own token metadata through the app
-- routes (app/api/mcp/tokens), never directly.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/101_mcp_server.sql

-- ── Personal access tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  token_hash         TEXT        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  prefix             TEXT        NOT NULL CHECK (length(prefix) BETWEEN 6 AND 24),
  scopes             TEXT[]      NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 20),
  created_via        TEXT        NOT NULL DEFAULT 'giga' CHECK (created_via IN ('giga', 'expert', 'telegram')),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID,
  last_used_at       TIMESTAMPTZ,
  last_used_ip_hash  TEXT        CHECK (last_used_ip_hash IS NULL OR length(last_used_ip_hash) <= 128),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tokens_expiry_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')
);
COMMENT ON TABLE public.mcp_tokens IS
  'MCP personal access tokens (101): SHA-256 hash only, scopes re-checked against the current role on every call.';
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON public.mcp_tokens (user_id, created_at DESC);

-- ── OAuth 2.1: clients (RFC 7591 dynamic registration) ──────────────────────
CREATE TABLE IF NOT EXISTS public.oauth_clients (
  client_id                   TEXT        PRIMARY KEY CHECK (client_id ~ '^mcpc_[A-Za-z0-9_-]{16,64}$'),
  client_name                 TEXT        CHECK (client_name IS NULL OR length(client_name) BETWEEN 1 AND 200),
  redirect_uris               TEXT[]      NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  grant_types                 TEXT[]      NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::text[]
                                          CHECK (grant_types <@ ARRAY['authorization_code', 'refresh_token']::text[]),
  token_endpoint_auth_method  TEXT        NOT NULL DEFAULT 'none'
                                          CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash          TEXT        CHECK (client_secret_hash IS NULL OR client_secret_hash ~ '^[0-9a-f]{64}$'),
  application_type            TEXT        CHECK (application_type IS NULL OR application_type IN ('native', 'web')),
  registration_ip_hash        TEXT        CHECK (registration_ip_hash IS NULL OR length(registration_ip_hash) <= 128),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at                TIMESTAMPTZ,
  CONSTRAINT oauth_clients_secret_matches_method
    CHECK ((token_endpoint_auth_method = 'none') = (client_secret_hash IS NULL))
);
COMMENT ON TABLE public.oauth_clients IS
  'OAuth clients of the MCP authorization server, registered via RFC 7591 (101). Secret stored as SHA-256 only.';

-- ── OAuth 2.1: authorization requests waiting for consent ───────────────────
CREATE TABLE IF NOT EXISTS public.oauth_auth_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    TEXT        NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2000),
  code_challenge  TEXT        NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes          TEXT[]      NOT NULL DEFAULT '{}'::text[],
  scope_requested BOOLEAN     NOT NULL DEFAULT false,
  resource        TEXT        NOT NULL CHECK (length(resource) BETWEEN 1 AND 2000),
  state           TEXT        CHECK (state IS NULL OR length(state) <= 1000),
  user_id         UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  decision        TEXT        CHECK (decision IS NULL OR decision IN ('approved', 'denied')),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_auth_requests_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS oauth_auth_requests_expires_idx ON public.oauth_auth_requests (expires_at);

-- ── OAuth 2.1: authorization codes ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oauth_auth_codes (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash              TEXT        NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id              TEXT        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id                UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  redirect_uri           TEXT        NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2000),
  code_challenge         TEXT        NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  code_challenge_method  TEXT        NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  scopes                 TEXT[]      NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 20),
  resource               TEXT        NOT NULL CHECK (length(resource) BETWEEN 1 AND 2000),
  expires_at             TIMESTAMPTZ NOT NULL,
  used_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_auth_codes_ttl
    CHECK (expires_at >= created_at + interval '60 seconds' AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_idx ON public.oauth_auth_codes (expires_at);

-- ── OAuth 2.1: access / refresh tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID        NOT NULL,
  rotated_from        UUID        REFERENCES public.oauth_tokens(id) ON DELETE SET NULL,
  code_id             UUID        REFERENCES public.oauth_auth_codes(id) ON DELETE SET NULL,
  client_id           TEXT        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_hash         TEXT        NOT NULL UNIQUE CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  refresh_hash        TEXT        UNIQUE CHECK (refresh_hash IS NULL OR refresh_hash ~ '^[0-9a-f]{64}$'),
  scopes              TEXT[]      NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 20),
  resource            TEXT        NOT NULL CHECK (length(resource) BETWEEN 1 AND 2000),
  expires_at          TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT        CHECK (revoked_reason IS NULL OR revoked_reason IN
                                    ('rotated', 'reuse_detected', 'code_reuse', 'revoked', 'access_lost')),
  last_used_at        TIMESTAMPTZ,
  last_used_ip_hash   TEXT        CHECK (last_used_ip_hash IS NULL OR length(last_used_ip_hash) <= 128),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_tokens_access_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 day'),
  CONSTRAINT oauth_tokens_refresh_pair CHECK ((refresh_hash IS NULL) = (refresh_expires_at IS NULL)),
  CONSTRAINT oauth_tokens_refresh_ttl CHECK (refresh_expires_at IS NULL OR refresh_expires_at <= created_at + interval '90 days'),
  CONSTRAINT oauth_tokens_revoked_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
COMMENT ON TABLE public.oauth_tokens IS
  'OAuth access/refresh pairs for the MCP resource (101): hashes only, RFC 8707 resource binding, rotation family for reuse detection.';
CREATE INDEX IF NOT EXISTS oauth_tokens_family_idx ON public.oauth_tokens (family_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON public.oauth_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oauth_tokens_code_idx ON public.oauth_tokens (code_id) WHERE code_id IS NOT NULL;

-- ── Audit of MCP calls ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_audit (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  credential_kind   TEXT        CHECK (credential_kind IS NULL OR credential_kind IN ('pat', 'oauth')),
  credential_id     UUID,
  client_id         TEXT,
  method            TEXT        NOT NULL CHECK (length(method) BETWEEN 1 AND 100),
  tool              TEXT        CHECK (tool IS NULL OR length(tool) <= 128),
  args_summary      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT        NOT NULL CHECK (status IN ('ok', 'error', 'denied', 'rate_limited', 'unauthorized', 'invalid')),
  error_code        TEXT        CHECK (error_code IS NULL OR length(error_code) <= 100),
  latency_ms        INTEGER     CHECK (latency_ms IS NULL OR latency_ms >= 0),
  protocol_version  TEXT        CHECK (protocol_version IS NULL OR length(protocol_version) <= 32),
  ip_hash           TEXT        CHECK (ip_hash IS NULL OR length(ip_hash) <= 128),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mcp_audit IS
  'Every MCP call (101): who, tool, argument summary without personal data, status, latency.';
CREATE INDEX IF NOT EXISTS mcp_audit_created_idx ON public.mcp_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_user_idx ON public.mcp_audit (user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- ── Server-only access ──────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_tokens', 'oauth_clients', 'oauth_auth_requests', 'oauth_auth_codes', 'oauth_tokens', 'mcp_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
