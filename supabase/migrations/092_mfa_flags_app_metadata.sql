-- 092_mfa_flags_app_metadata.sql
--
-- The "this account has a second factor" flags (mfa_totp / mfa_webauthn) that
-- middleware reads from the JWT lived only in auth.users.raw_user_meta_data,
-- which the account holder can rewrite with supabase.auth.updateUser(). A
-- stolen session could therefore set mfa_totp=false and skip the step-up.
--
-- From now on the authoritative copy is raw_app_meta_data (writable only by
-- the service role; lib/mfa/store.ts writes both, lib/mfa/flags.ts ORs both).
-- This backfills app metadata from the real enrolment state:
--   user_security.totp_enabled  → mfa_totp
--   any webauthn_credentials row → mfa_webauthn
-- Existing JWTs pick the new claims up on their next refresh; until then the
-- old user_metadata flag still gates them (OR).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/092_mfa_flags_app_metadata.sql

DO $$
BEGIN
  IF to_regclass('public.user_security') IS NOT NULL THEN
    UPDATE auth.users u
    SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('mfa_totp', true)
    FROM public.user_security s
    WHERE s.user_id = u.id
      AND s.totp_enabled
      AND (u.raw_app_meta_data ->> 'mfa_totp') IS DISTINCT FROM 'true';
  END IF;

  IF to_regclass('public.webauthn_credentials') IS NOT NULL THEN
    UPDATE auth.users u
    SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('mfa_webauthn', true)
    WHERE EXISTS (SELECT 1 FROM public.webauthn_credentials w WHERE w.user_id = u.id)
      AND (u.raw_app_meta_data ->> 'mfa_webauthn') IS DISTINCT FROM 'true';
  END IF;
END $$;
