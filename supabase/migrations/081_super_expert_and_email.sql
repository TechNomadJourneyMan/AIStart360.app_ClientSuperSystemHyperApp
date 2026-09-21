-- 081_super_expert_and_email.sql — роль SuperExpert, записи приглашений и журнал писем.
--
-- Всё аддитивно и идемпотентно. Существующие роли, данные и политики не трогаем.
--
--   staff_roles.role CHECK  — добавляем 'super_expert' к списку ролей персонала
--   platform_invitations    — запись о приглашении (без самого токена!): кому,
--                             кем, с какой ролью, когда истекает, когда принято
--   email_deliveries        — журнал транзакционных писем + защита от дублей
--
-- Доступ к новым таблицам — только service_role (RLS включён, политик нет).
-- Применение: node scripts/apply-migration.js supabase/migrations/081_super_expert_and_email.sql

-- ─── 1. Роль SuperExpert в staff_roles ───────────────────────────────────────
-- Имя ограничения задаётся Postgres как <table>_<column>_check. Пересоздаём.
ALTER TABLE public.staff_roles DROP CONSTRAINT IF EXISTS staff_roles_role_check;
ALTER TABLE public.staff_roles
  ADD CONSTRAINT staff_roles_role_check
  CHECK (role IN ('super_admin','admin','super_expert','crm_manager','content_manager','analyst','support'));

-- ─── 2. Приглашения на платформу ─────────────────────────────────────────────
-- Токен НЕ хранится: одноразовую ссылку выдаёт Supabase (generateLink) и она
-- живёт только в письме. Здесь — сам факт приглашения и его судьба.
CREATE TABLE IF NOT EXISTS public.platform_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  -- Роль персонала, которую человек получит после принятия (NULL = обычный клиент).
  staff_role   TEXT CHECK (staff_role IS NULL OR staff_role IN ('super_admin','admin','super_expert','crm_manager','content_manager','analyst','support')),
  status       TEXT NOT NULL DEFAULT 'sent'
               CHECK (status IN ('sent','accepted','expired','failed','revoked')),
  -- 'invite' — новый аккаунт, 'magiclink' — у человека уже есть профиль.
  link_type    TEXT NOT NULL DEFAULT 'invite' CHECK (link_type IN ('invite','magiclink')),
  note         TEXT,
  next_path    TEXT,
  company_name TEXT,
  invited_by   TEXT,
  invited_by_email TEXT,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '1 hour',
  accepted_at  TIMESTAMPTZ,
  resend_count INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_invitations_email_idx ON public.platform_invitations (lower(email), sent_at DESC);
CREATE INDEX IF NOT EXISTS platform_invitations_sent_idx ON public.platform_invitations (sent_at DESC);
CREATE INDEX IF NOT EXISTS platform_invitations_status_idx ON public.platform_invitations (status, sent_at DESC);
ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_invitations FROM anon, authenticated;

-- ─── 3. Журнал транзакционных писем ──────────────────────────────────────────
-- dedupe_key — ключ идемпотентности («это письмо уже уходило»). Уникальный
-- индекс делает повторную отправку невозможной даже при гонке двух воркеров.
CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dedupe_key  TEXT,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  provider_id TEXT,
  error       TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_dedupe_uniq
  ON public.email_deliveries (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_deliveries_recipient_idx ON public.email_deliveries (lower(recipient), created_at DESC);
CREATE INDEX IF NOT EXISTS email_deliveries_user_idx ON public.email_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_deliveries_kind_idx ON public.email_deliveries (kind, created_at DESC);
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_deliveries FROM anon, authenticated;
