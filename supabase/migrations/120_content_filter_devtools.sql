-- 120_content_filter_devtools.sql
--
-- 1. Content filter (lib/moderation): free text with obscene language, insults
--    or spam is NOT saved — the request is rejected, the attempt is written to
--    content_moderation_events and staff are notified.
--    content_filter_terms is the editable dictionary on top of the built-in
--    rules: 'block' adds a word (matched as a word prefix), 'allow' exempts a
--    word that the built-in rules would otherwise catch.
-- 2. Dev-tools of Super Admin: profiles.is_test marks test accounts created
--    from /admin-giga-panel/dev-tools (one click «удалить все тестовые»).
--
-- Both tables are written by the server (service role) only; staff read them
-- through the GIGA-CRM API. RLS on, no policies for API roles.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/120_content_filter_devtools.sql

CREATE TABLE IF NOT EXISTS public.content_moderation_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   TEXT,
  source       TEXT NOT NULL,                 -- e.g. 'register', 'profile', 'company', 'survey'
  field        TEXT NOT NULL,                 -- machine name of the field
  field_label  TEXT,                          -- human label shown to staff
  categories   TEXT[] NOT NULL DEFAULT '{}',  -- mat | insult | spam | custom
  terms        TEXT[] NOT NULL DEFAULT '{}',  -- masked matches, e.g. «х**»
  excerpt      TEXT,                          -- masked fragment of the text (≤ 300 chars)
  action       TEXT NOT NULL DEFAULT 'blocked' CHECK (action IN ('blocked')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'false_positive')),
  reviewed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_moderation_events_created_idx ON public.content_moderation_events (created_at DESC);
CREATE INDEX IF NOT EXISTS content_moderation_events_user_idx ON public.content_moderation_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_moderation_events_open_idx ON public.content_moderation_events (status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.content_filter_terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term        TEXT NOT NULL CHECK (char_length(term) BETWEEN 2 AND 60),
  kind        TEXT NOT NULL CHECK (kind IN ('block', 'allow')),
  note        TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_filter_terms_unique ON public.content_filter_terms (lower(term), kind);

ALTER TABLE public.content_moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_filter_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_moderation_events FROM anon, authenticated;
REVOKE ALL ON public.content_filter_terms FROM anon, authenticated;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS profiles_is_test_idx ON public.profiles (is_test) WHERE is_test;

NOTIFY pgrst, 'reload schema';
