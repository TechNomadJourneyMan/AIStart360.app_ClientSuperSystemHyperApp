-- Settings rework — single JSONB "preferences" bag on profiles.
-- Powers Settings › Внешний вид (appearance) and Уведомления (notification prefs),
-- and Profile › соцсети, WITHOUT introducing new tables.
-- Additive + idempotent: safe to run multiple times, non-destructive.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.preferences IS
  'User settings bag: { appearance:{theme,density,font_scale,...}, notifications:{<category>:{in_app,email,telegram}}, socials:{telegram,linkedin,website,...} }. Managed by /api/v1/settings/*';
