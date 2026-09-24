-- 086_expert_workspace.sql — рабочее место эксперта (пакет 1a).
--
-- Всё аддитивно и идемпотентно, существующие данные не меняются.
--
--   staff_roles.client_scope — каких клиентов видит сотрудник:
--       'all'      — всех (по умолчанию, текущее поведение);
--       'assigned' — только тех, где он ответственный (user_assignments.assignee_id).
--     Роли super_admin / admin / crm_manager всегда видят всех — это правило
--     живёт в коде (lib/admin/rbac.ts effectiveClientScope), значение колонки
--     для них игнорируется. Проверка — на каждом API-маршруте
--     (lib/admin/client-scope.ts).
--
--   staff_client_views — когда сотрудник последний раз открывал карточку
--     клиента (User 360). По ней «Мой день» показывает, что у клиента
--     изменилось с прошлого просмотра.
--
-- Доступ к новой таблице — только service_role (RLS включён, политик нет).
-- Применение: node scripts/apply-migration.js supabase/migrations/086_expert_workspace.sql

-- ─── 1. Область видимости клиентов ───────────────────────────────────────────
ALTER TABLE public.staff_roles
  ADD COLUMN IF NOT EXISTS client_scope TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_roles_client_scope_check'
      AND conrelid = 'public.staff_roles'::regclass
  ) THEN
    ALTER TABLE public.staff_roles
      ADD CONSTRAINT staff_roles_client_scope_check CHECK (client_scope IN ('all', 'assigned'));
  END IF;
END
$$;

COMMENT ON COLUMN public.staff_roles.client_scope IS
  'all — сотрудник видит всех клиентов; assigned — только назначенных ему (user_assignments.assignee_id). Для super_admin/admin/crm_manager игнорируется.';

-- Быстрый ответ на «мои клиенты» (индекс мог появиться в 082 — IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS user_assignments_assignee_idx ON public.user_assignments (assignee_id);

-- ─── 2. Последний просмотр клиента сотрудником ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_client_views (
  staff_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, user_id)
);
CREATE INDEX IF NOT EXISTS staff_client_views_staff_idx
  ON public.staff_client_views (staff_id, last_viewed_at DESC);

ALTER TABLE public.staff_client_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_client_views FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_client_views TO service_role;

COMMENT ON TABLE public.staff_client_views IS
  'Когда сотрудник последний раз открывал User 360 клиента. Основа блока «Что изменилось» на странице «Мой день». Только service_role.';

NOTIFY pgrst, 'reload schema';
