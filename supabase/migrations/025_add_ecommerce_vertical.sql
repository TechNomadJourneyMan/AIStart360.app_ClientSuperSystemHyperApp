-- Allow 'ecommerce' as a profile vertical alongside generic and medical.
-- See lib/verticals.ts for the full registry.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_vertical_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_vertical_check
  CHECK (vertical IN ('generic', 'medical', 'ecommerce'));

COMMENT ON COLUMN public.profiles.vertical IS
  'Product vertical this tenant uses: generic (default B2B), medical (clinic flow), ecommerce (online store / D2C / marketplaces). See lib/verticals.ts.';
