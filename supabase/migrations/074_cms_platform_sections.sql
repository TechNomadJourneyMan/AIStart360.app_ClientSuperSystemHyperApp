-- 074_cms_platform_sections.sql — управление контентом и структурой платформы.
--
--   cms_pages / cms_blocks / cms_page_revisions — страницы материалов из блоков
--     (Draft → Published → Archived), с историей версий и правилами видимости;
--   platform_sections — встроенные разделы кабинета (Точка А/Б, GRI, CJM …):
--     включение, порядок, видимость по сегментам;
--   user_segment_facts(uuid) — факты для правил видимости одного пользователя;
--   admin_survey_step_users() — счётчики по шагам без лимита PostgREST в 1000 строк;
--   бакет cms-media для изображений/видео/документов;
--   бэкфил profiles.last_seen_at из auth.users.last_sign_in_at.
--
-- Всё аддитивно. Доступ к таблицам — только service_role: видимость
-- вычисляется на сервере (lib/platform/visibility.ts).
-- Применение: node scripts/apply-migration.js supabase/migrations/074_cms_platform_sections.sql

-- ─── 1. Страницы ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cms_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary       TEXT CHECK (summary IS NULL OR char_length(summary) <= 500),
  category      TEXT CHECK (category IS NULL OR char_length(category) <= 60),
  icon          TEXT CHECK (icon IS NULL OR icon ~ '^[a-z0-9_]{1,40}$'),
  cover_url     TEXT CHECK (cover_url IS NULL OR char_length(cover_url) <= 1000),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  visibility    JSONB NOT NULL DEFAULT '{"audience":"all"}'::jsonb,
  show_in_nav   BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 100,
  version       INT NOT NULL DEFAULT 1,
  published_at  TIMESTAMPTZ,
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_pages_status_idx ON public.cms_pages (status, sort_order);

CREATE TABLE IF NOT EXISTS public.cms_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     UUID NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('heading','text','image','video','document','callout','cta','divider')),
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order  INT NOT NULL DEFAULT 0,
  hidden      BOOLEAN NOT NULL DEFAULT false,
  visibility  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_blocks_page_idx ON public.cms_blocks (page_id, sort_order);

CREATE TABLE IF NOT EXISTS public.cms_page_revisions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id     UUID NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  status      TEXT NOT NULL,
  snapshot    JSONB NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_revisions_page_idx ON public.cms_page_revisions (page_id, created_at DESC);

ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_page_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_pages, public.cms_blocks, public.cms_page_revisions FROM anon, authenticated;

-- ─── 2. Разделы платформы ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_sections (
  key          TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  title        TEXT NOT NULL,
  description  TEXT,
  icon         TEXT,
  nav_href     TEXT NOT NULL,
  paths        TEXT[] NOT NULL DEFAULT '{}',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  visibility   JSONB NOT NULL DEFAULT '{"audience":"all"}'::jsonb,
  sort_order   INT NOT NULL DEFAULT 100,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sections FROM anon, authenticated;

INSERT INTO public.platform_sections (key, title, description, icon, nav_href, paths, sort_order) VALUES
  ('point_a',   'Точка А',            'Диагностика текущего состояния бизнеса',     'my_location',  '/client/point-a',              ARRAY['/point-a','/client/point-a'], 10),
  ('gri',       'GRI Assessment',     'Индекс готовности к росту и план на 90 дней', 'radar',        '/gri',                         ARRAY['/gri'], 20),
  ('point_b',   'Точка Б',            'Цель, разрыв и дорожная карта',              'flag_circle',  '/client/point-b',              ARRAY['/point-b','/client/point-b'], 30),
  ('cjm',       'Путь клиента (CJM)', 'Где клиенты теряются и что исправить',       'route',        '/client/journey',              ARRAY['/client/journey'], 40),
  ('documents', 'Документы',          'Отчёты и выгрузки для диагностики',          'cloud_upload', '/client/onboarding/documents', ARRAY['/client/onboarding/documents'], 50),
  ('content',   'Материалы',          'Обучение и полезные материалы',              'menu_book',    '/client/content',              ARRAY['/client/content'], 60),
  ('simulator', 'Симулятор',          'Сценарии «что если» для бизнеса',            'query_stats',  '/simulator',                   ARRAY['/simulator'], 70),
  ('metrics',   'Метрики',            'Каталог бизнес-метрик',                      'monitoring',   '/metrics',                     ARRAY['/metrics'], 80),
  ('market',    'Рынок',              'Анализ рынка и конкурентов',                 'public',       '/market',                      ARRAY['/market'], 90),
  ('pulse',     'Клиенты (CRM)',      'Своя клиентская база и напоминания',         'groups',       '/pulse',                       ARRAY['/pulse'], 100)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Медиа ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('cms-media', 'cms-media', true, 26214400,
            ARRAY['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ─── 4. Факты для правил видимости ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_segment_facts(p_user UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'role', p.role,
    'status', p.status,
    'tier', COALESCE(p.tier, 'free'),
    'vertical', COALESCE(p.vertical, 'generic'),
    'created_at', p.created_at,
    'survey_steps', (
      SELECT count(DISTINCT sa.step) FROM public.survey_answers sa
      WHERE sa.user_id = p.id AND sa.step BETWEEN 1 AND 12
        AND sa.question_key ~ '^s[0-9]+[a-z]?_'
        AND sa.answer ? 'value'
        AND jsonb_typeof(sa.answer -> 'value') <> 'null'
        AND (sa.answer -> 'value') NOT IN ('""'::jsonb, '[]'::jsonb, '{}'::jsonb)
    ),
    'gri_runs', (SELECT count(*) FROM public.gri_assessments g WHERE g.user_id = p.id),
    'is_staff', (p.role IN ('super_admin','admin') OR EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id))
  )
  FROM public.profiles p
  WHERE p.id = p_user
$$;

CREATE OR REPLACE FUNCTION public.admin_survey_step_users()
RETURNS TABLE (step INT, users INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sa.step::int, count(DISTINCT sa.user_id)::int
  FROM public.survey_answers sa
  WHERE sa.step BETWEEN 1 AND 12 AND sa.question_key ~ '^s[0-9]+[a-z]?_'
  GROUP BY sa.step
$$;

REVOKE ALL ON FUNCTION public.user_segment_facts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_survey_step_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_segment_facts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_survey_step_users() TO service_role;

-- ─── 5. Последняя активность до появления трекинга ───────────────────────────
UPDATE public.profiles p
SET last_seen_at = u.last_sign_in_at
FROM auth.users u
WHERE u.id = p.id
  AND p.last_seen_at IS NULL
  AND u.last_sign_in_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
