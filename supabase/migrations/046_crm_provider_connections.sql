-- AIStart360 — Migration 046: подключения внешних CRM (Фаза 4B)
--
-- Своя таблица подключений AmoCRM/Bitrix24 ВМЕСТО мёртвой Prisma-модели
-- crm_integrations (requireCrmOrg всегда null → /api/crm 403; findFirst без
-- скоупа = межарендная утечка). RLS own CRUD: чужие креды не видит НИКТО, даже
-- staff (в отличие от crm_clients) — отсюда нет staff-read политики.
--
-- Токены пока plaintext (как в legacy) — известное ограничение; шифрование
-- вынесено в отдельную задачу (Фаза 6+). Идемпотентно.

CREATE TABLE IF NOT EXISTS public.crm_provider_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('bitrix24','amocrm')),
  base_url          TEXT NOT NULL,               -- домен/портал (mycompany.bitrix24.kz)
  access_token      TEXT NOT NULL,               -- webhook-secret или OAuth-токен
  connection_name   TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT,                         -- 'ok' | 'error'
  last_sync_error   TEXT,
  synced_deals      INTEGER NOT NULL DEFAULT 0,
  synced_contacts   INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_crm_conn_user ON public.crm_provider_connections (user_id);

ALTER TABLE public.crm_provider_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_conn_sel_own ON public.crm_provider_connections;
DROP POLICY IF EXISTS crm_conn_ins_own ON public.crm_provider_connections;
DROP POLICY IF EXISTS crm_conn_upd_own ON public.crm_provider_connections;
DROP POLICY IF EXISTS crm_conn_del_own ON public.crm_provider_connections;

CREATE POLICY crm_conn_sel_own ON public.crm_provider_connections
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY crm_conn_ins_own ON public.crm_provider_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY crm_conn_upd_own ON public.crm_provider_connections
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY crm_conn_del_own ON public.crm_provider_connections
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.crm_provider_connections IS
  'Подключения внешних CRM (AmoCRM/Bitrix24) per user; RLS own — креды приватны.';

NOTIFY pgrst, 'reload schema';
