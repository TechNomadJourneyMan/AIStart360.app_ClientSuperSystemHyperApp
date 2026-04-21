-- Phase 1 of clinic vertical: add `vertical` + `branding` columns to profiles
-- so each organisation (tenant) can run on either the generic B2B flow or the
-- medical flow without forking the app. Default 'generic' — all existing rows
-- stay on the current flow, no behaviour change.

-- ── vertical ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'generic'
    CHECK (vertical IN ('generic', 'medical'));

COMMENT ON COLUMN public.profiles.vertical IS
  'Product vertical this tenant uses: generic (default B2B) or medical (clinic flow). See lib/verticals.ts.';

-- Index for fast filtering in admin lists (Гига-Панель shows per-vertical tables)
CREATE INDEX IF NOT EXISTS idx_profiles_vertical ON public.profiles(vertical)
  WHERE vertical <> 'generic';

-- ── branding ────────────────────────────────────────────────────────────────
-- Stored as JSONB so we can add fields later without another migration.
-- Expected shape: { logo_url?, primary_color?, secondary_color?, product_name? }
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branding JSONB;

COMMENT ON COLUMN public.profiles.branding IS
  'Optional white-label metadata: logo_url, primary_color, secondary_color, product_name. Rendered in layout + PDF + emails.';
