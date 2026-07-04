-- =============================================================================
-- Migration 040: system_settings (global key/value settings)
-- First use: registration_mode (open | approval | invite).
-- RLS ON with NO policies → reachable ONLY via the service role in server code.
-- Additive + idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.system_settings IS
  'Global key/value settings (registration_mode, feature flags). RLS on, NO policies → service-role only.';

-- Seed registration_mode to the CURRENT behaviour (admin approval required), so
-- applying this migration changes nothing until an admin flips the toggle.
INSERT INTO public.system_settings (key, value)
VALUES ('registration_mode', '"approval"'::jsonb)
ON CONFLICT (key) DO NOTHING;
