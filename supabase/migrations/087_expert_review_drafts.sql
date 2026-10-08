-- 087_expert_review_drafts.sql — разбор эксперта: черновики, одна публикация,
-- шаблоны, ревью экспертной Точки Б (F-030, F-031, F-074; аудит 03 К-6, E10–E13).
--
-- Всё аддитивно и идемпотентно (можно применять повторно).
--
--   expert_comments   + status draft|published, published_at, review_id,
--                       source expert|ai, ai_flags (замечания валидатора к ИИ-тексту)
--                     — клиент видит ТОЛЬКО опубликованные комментарии (RLS)
--   expert_reviews    — разбор: черновик копится, публикуется одним действием
--                       (одно письмо и одно уведомление клиенту)
--   expert_templates  — библиотека формулировок эксперта по блокам
--   point_b_versions  — экспертная Точка Б по умолчанию НЕ одобрена;
--                       одобряет Admin / Super Admin (approved_by, approved_at);
--                       клиент видит только одобренные версии (RLS)
--
-- Новые таблицы персонала — только service_role (RLS включён, политик для
-- anon/authenticated нет). Клиент читает свой разбор через
-- GET /api/v1/expert-review (сессия + явный фильтр status='published').
--
-- Применение: node scripts/apply-migration.js supabase/migrations/087_expert_review_drafts.sql

-- ─── 1. Разбор эксперта ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expert_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  title         TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  summary       TEXT CHECK (summary IS NULL OR char_length(summary) <= 5000),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expert_reviews_user_idx ON public.expert_reviews (user_id, status, published_at DESC);
-- Один текущий черновик на клиента: эксперты дописывают общий разбор.
CREATE UNIQUE INDEX IF NOT EXISTS expert_reviews_one_draft_idx ON public.expert_reviews (user_id) WHERE status = 'draft';

ALTER TABLE public.expert_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expert_reviews FROM anon;
DROP POLICY IF EXISTS expert_reviews_owner_read_published ON public.expert_reviews;
CREATE POLICY expert_reviews_owner_read_published ON public.expert_reviews
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND status = 'published');

-- ─── 2. Комментарии: черновик / опубликовано ────────────────────────────────
ALTER TABLE public.expert_comments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE public.expert_comments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE public.expert_comments ADD COLUMN IF NOT EXISTS review_id UUID;
ALTER TABLE public.expert_comments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'expert';
ALTER TABLE public.expert_comments ADD COLUMN IF NOT EXISTS ai_flags JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_comments_status_check') THEN
    ALTER TABLE public.expert_comments
      ADD CONSTRAINT expert_comments_status_check CHECK (status IN ('draft', 'published'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_comments_source_check') THEN
    ALTER TABLE public.expert_comments
      ADD CONSTRAINT expert_comments_source_check CHECK (source IN ('expert', 'ai'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_comments_review_fk') THEN
    ALTER TABLE public.expert_comments
      ADD CONSTRAINT expert_comments_review_fk FOREIGN KEY (review_id)
      REFERENCES public.expert_reviews(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Старые комментарии уже видны клиенту — считаем их опубликованными в момент создания.
UPDATE public.expert_comments
   SET published_at = created_at
 WHERE status = 'published' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expert_comments_client_status
  ON public.expert_comments (client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expert_comments_review
  ON public.expert_comments (review_id);

-- Клиент читает только опубликованное: черновики эксперта ему не видны.
DROP POLICY IF EXISTS "client_read_own" ON public.expert_comments;
CREATE POLICY "client_read_own" ON public.expert_comments
  FOR SELECT USING (client_id = auth.uid() AND status = 'published');

-- ─── 3. Шаблоны эксперта ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expert_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block       TEXT NOT NULL DEFAULT 'general' CHECK (char_length(block) BETWEEN 1 AND 100),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_shared   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expert_templates_block_idx ON public.expert_templates (block, updated_at DESC);
CREATE INDEX IF NOT EXISTS expert_templates_author_idx ON public.expert_templates (created_by);
ALTER TABLE public.expert_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expert_templates FROM anon, authenticated;

-- ─── 4. Точка Б эксперта: ревью старшим ─────────────────────────────────────
ALTER TABLE public.point_b_versions ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE public.point_b_versions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.point_b_versions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
UPDATE public.point_b_versions
   SET approved_at = created_at
 WHERE is_approved AND approved_at IS NULL;

-- Владелец видит только одобренные версии своей Точки Б.
DROP POLICY IF EXISTS point_b_versions_owner_read ON public.point_b_versions;
CREATE POLICY point_b_versions_owner_read ON public.point_b_versions
  FOR SELECT TO authenticated
  USING (
    point_b_versions.is_approved
    AND EXISTS (
      SELECT 1 FROM public.diagnostics d
      WHERE d.id = point_b_versions.diagnostic_id AND d.user_id = auth.uid()
    )
  );

-- ─── 5. updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_review_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expert_reviews_updated_at ON public.expert_reviews;
CREATE TRIGGER trg_expert_reviews_updated_at
  BEFORE UPDATE ON public.expert_reviews
  FOR EACH ROW EXECUTE FUNCTION public.expert_review_touch_updated_at();

DROP TRIGGER IF EXISTS trg_expert_templates_updated_at ON public.expert_templates;
CREATE TRIGGER trg_expert_templates_updated_at
  BEFORE UPDATE ON public.expert_templates
  FOR EACH ROW EXECUTE FUNCTION public.expert_review_touch_updated_at();
