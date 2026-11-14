-- 142_ops_backup_runs.sql
--
-- Журнал бэкапов базы и файлов Storage (R-011, docs/backup/README.md).
--
--   ops_backup_runs   одна строка на каждый запуск скрипта scripts/backup/railway-db-backup.sh
--                     (cron-сервис Railway `db-backup`, 3 раза в сутки) — и при успехе (ok = true),
--                     и при сбое (ok = false + error). kind = 'db' — дамп базы, 'storage' — копия
--                     файлов Storage, 'vps' — передача дампа на резервный сервер.
--                     Крон портала /api/cron/backup-freshness раз в час смотрит последнюю строку
--                     kind = 'db' и зовёт супер-админов, если успешного бэкапа нет дольше 10 ч или
--                     последний запуск упал (lib/ops/backup-freshness.ts).
--
-- Пишет только скрипт бэкапа (psql под ролью из POSTGRES_PRIVATE_URL) и сервер портала (Prisma).
-- RLS включён без единой политики; anon / authenticated не получают НИЧЕГО (REVOKE ALL) —
-- журнал не виден через PostgREST. service_role — полный доступ.
--
-- Идемпотентна. На прод НЕ применена автором файла: node scripts/apply-migration.js
-- supabase/migrations/142_ops_backup_runs.sql — до первого запуска нового скрипта бэкапа
-- (без таблицы скрипт бэкапа всё равно отработает: запись в журнал — best effort).

CREATE TABLE IF NOT EXISTS public.ops_backup_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN     NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('db', 'storage', 'vps')),
  bytes        BIGINT      CHECK (bytes IS NULL OR bytes >= 0),
  tables       INTEGER     CHECK (tables IS NULL OR tables >= 0),
  sha256       TEXT        CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  object_key   TEXT        CHECK (object_key IS NULL OR length(object_key) <= 512),
  error        TEXT        CHECK (error IS NULL OR length(error) <= 4000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Последний запуск каждого вида и последний успешный — то, что читает крон свежести.
CREATE INDEX IF NOT EXISTS ops_backup_runs_kind_started_idx
  ON public.ops_backup_runs (kind, started_at DESC);
CREATE INDEX IF NOT EXISTS ops_backup_runs_kind_ok_finished_idx
  ON public.ops_backup_runs (kind, finished_at DESC) WHERE ok;

ALTER TABLE public.ops_backup_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ops_backup_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_backup_runs TO service_role;

COMMENT ON TABLE public.ops_backup_runs IS
  'Журнал бэкапов (scripts/backup/railway-db-backup.sh). Только service_role / postgres; RLS без политик.';

NOTIFY pgrst, 'reload schema';
