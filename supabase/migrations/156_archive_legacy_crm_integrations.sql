-- 156_archive_legacy_crm_integrations.sql
--
-- Решение PO 2026-11-18: старую CRM на Prisma — «в архив». Код уехал в archive/legacy-prisma-crm/,
-- а её таблица public.crm_integrations (подключения Bitrix24/amoCRM старого стека, по org,
-- с токеном и адресом вебхука ОТКРЫТЫМ ТЕКСТОМ) — в схему archive.
--
--   • Ничего не удаляется: таблица, её строки, индексы и ключи переезжают как есть
--     (ALTER TABLE … SET SCHEMA), откат — одна команда (rollback/156_…down.sql).
--   • Схема archive закрыта от API: PostgREST отдаёт только public (и storage/graphql),
--     а у anon / authenticated нет USAGE на archive — даже прямой SQL этих ролей её не читает.
--     Читает только владелец базы / service_role через SQL.
--   • Таблица была уже закрыта от API ролей с 084 (REVOKE ALL); RLS остаётся включённым.
--   • Живая CRM владельца — crm_clients / crm_provider_connections (044/046) — не затрагивается.
--   • Если таблицы нет (свежая база без модели Prisma CrmIntegration, CI) — миграция ничего
--     не делает, кроме создания пустой закрытой схемы archive.
--
-- Отозвать сам вебхук Bitrix24 может только владелец портала Bitrix24 — это делается в Bitrix24,
-- не здесь.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS archive;
COMMENT ON SCHEMA archive IS
  'Архив: данные выведенных из работы подсистем. Закрыта от API (нет USAGE у anon/authenticated).';
REVOKE ALL ON SCHEMA archive FROM PUBLIC;
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;
GRANT USAGE ON SCHEMA archive TO service_role;

DO $$
BEGIN
  IF to_regclass('public.crm_integrations') IS NOT NULL
     AND to_regclass('archive.crm_integrations') IS NULL THEN
    ALTER TABLE public.crm_integrations SET SCHEMA archive;
  END IF;
  IF to_regclass('archive.crm_integrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE archive.crm_integrations FROM anon, authenticated;
    ALTER TABLE archive.crm_integrations ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE archive.crm_integrations IS
      'АРХИВ (2026-11-18, миграция 156): подключения CRM старого стека Prisma (/api/crm). Не используется. '
      'Токены и вебхуки хранятся открытым текстом — не выносить из базы; вебхук отзывается в Bitrix24.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
