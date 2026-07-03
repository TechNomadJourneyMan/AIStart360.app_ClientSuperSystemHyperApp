-- MFA / passkey storage. Auth-user-scoped (references auth.users — the Supabase
-- identity model). RLS is ENABLED with NO policies: these tables hold secrets
-- (TOTP seeds, backup-code hashes, credential public keys) and must be
-- reachable ONLY through the service role in server code — never from the
-- browser anon client. Additive + idempotent.

-- ── TOTP + backup codes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_security (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  totp_enabled     boolean     NOT NULL DEFAULT false,
  totp_secret_enc  text,        -- AES-256-GCM: active TOTP secret (v1:iv:tag:ct)
  totp_pending_enc text,        -- AES-256-GCM: secret awaiting first verification
  backup_codes     text[]      NOT NULL DEFAULT '{}',  -- bcrypt hashes; consumed on use
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.user_security IS
  'Per-user MFA secrets (TOTP + backup-code hashes). RLS on, NO policies → service-role only. Secrets AES-256-GCM encrypted at rest.';

-- ── WebAuthn / passkey credentials (Phase 2) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id           text        PRIMARY KEY,              -- credential ID (base64url)
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key   text        NOT NULL,                 -- base64url COSE public key
  counter      bigint      NOT NULL DEFAULT 0,
  transports   text[]      NOT NULL DEFAULT '{}',
  device_type  text,                                 -- 'singleDevice' | 'multiDevice'
  backed_up    boolean     NOT NULL DEFAULT false,
  label        text,                                 -- user-facing device name
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON public.webauthn_credentials(user_id);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.webauthn_credentials IS
  'WebAuthn/passkey credentials (Phase 2). RLS on, NO policies → service-role only.';
