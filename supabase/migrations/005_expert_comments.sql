-- Expert comments on client accounts
-- Each expert can leave free-text advice attached to a client's account,
-- optionally scoped to a Point A block (finance/sales/operations/marketing/strategy).
-- Clients see these comments in their dashboard; each expert can edit/delete their own.

-- Free-text expert specialisation tag (shown as a chip next to the expert's name)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expert_title TEXT;

CREATE TABLE IF NOT EXISTS public.expert_comments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id    UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Snapshot of the author's expert_title at write time so the tag survives
  -- even if the expert later changes their specialisation.
  author_title TEXT,
  -- Point A block the comment is attached to. NULL = general feed (no block).
  block_key    TEXT,
  text         TEXT         NOT NULL CHECK (char_length(text) BETWEEN 1 AND 5000),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expert_comments_client
  ON public.expert_comments(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expert_comments_author
  ON public.expert_comments(author_id);

-- RLS
ALTER TABLE public.expert_comments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running this migration
DROP POLICY IF EXISTS "expert_create_own"   ON public.expert_comments;
DROP POLICY IF EXISTS "client_read_own"     ON public.expert_comments;
DROP POLICY IF EXISTS "expert_read_all"     ON public.expert_comments;
DROP POLICY IF EXISTS "expert_update_own"   ON public.expert_comments;
DROP POLICY IF EXISTS "expert_delete_own"   ON public.expert_comments;

-- Expert can only insert as themselves
CREATE POLICY "expert_create_own" ON public.expert_comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('expert', 'admin', 'super_admin')
    )
  );

-- Clients can read only their own comments
CREATE POLICY "client_read_own" ON public.expert_comments
  FOR SELECT USING (client_id = auth.uid());

-- Experts / admins can read all
CREATE POLICY "expert_read_all" ON public.expert_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('expert', 'admin', 'super_admin')
    )
  );

-- Expert can update only their own
CREATE POLICY "expert_update_own" ON public.expert_comments
  FOR UPDATE USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Expert can delete only their own
CREATE POLICY "expert_delete_own" ON public.expert_comments
  FOR DELETE USING (author_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_expert_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expert_comments_updated_at ON public.expert_comments;
CREATE TRIGGER trg_expert_comments_updated_at
  BEFORE UPDATE ON public.expert_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_expert_comment_updated_at();
