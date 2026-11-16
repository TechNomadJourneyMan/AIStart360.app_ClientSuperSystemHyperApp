-- 154_ops_job_runs.sql
--
-- Журнал исходов плановых задач (R4-A1: находки N4A-3, N4A-4, N4A-15 аудита R4-AUDIT-A).
--
--   ops_job_runs  одна строка на каждый исход:
--                 kind = 'cron'    вызов маршрута встроенным планировщиком (lib/cron/runner.ts):
--                                  ok (2xx), http_error (ответ не 2xx), error (сеть / исключение),
--                                  timeout (300 с без ответа) и claim_failed — захват минуты в
--                                  workflow-db не удался, задача НЕ вызывалась;
--                 kind = 'inngest' завершённый запуск функции Inngest по расписанию (обёртка
--                                  lib/functions/ops-ping.ts в lib/functions/registry.ts) и
--                                  синтетический пинг ops-ping: ok / error (последняя попытка).
--                 service — роль процесса (PORTAL_ROLE): all / web / agents.
--
--   Кто читает: сторож /api/cron/ops-watchdog (lib/ops/job-watchdog.ts) — «не запускалась
--   N часов» (интервал расписания × 2), он же раз в проход удаляет строки старше 30 дней;
--   /api/health — свежесть журнала своей роли (lib/health/platform.ts); ГИГА → Система.
--
-- Пишет только сервер: отдельный маленький пул pg к той же базе, что у Prisma процесса
-- (lib/ops/job-journal.ts), запись — best effort, её сбой не мешает самой задаче.
-- RLS включён без единой политики; anon / authenticated не получают НИЧЕГО (REVOKE ALL) —
-- журнал не виден через PostgREST. service_role — полный доступ.
--
-- Идемпотентна (IF NOT EXISTS). Без таблицы код работает как раньше: запись в журнал
-- молча пропускается, сторож отвечает 503 «migration_154_required».
-- Откат: supabase/migrations/rollback/154_ops_job_runs.down.sql
--   node scripts/apply-migration.js supabase/migrations/154_ops_job_runs.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.ops_job_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job            TEXT        NOT NULL CHECK (length(job) BETWEEN 1 AND 200),
  kind           TEXT        NOT NULL CHECK (kind IN ('cron', 'inngest')),
  service        TEXT        NOT NULL CHECK (service IN ('all', 'web', 'agents')),
  -- Минута, на которую задача стояла в расписании (только kind = 'cron').
  scheduled_for  TIMESTAMPTZ,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms    INTEGER     CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status         TEXT        NOT NULL CHECK (status IN ('ok', 'http_error', 'error', 'timeout', 'claim_failed')),
  http_status    SMALLINT    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  -- Первая строка ошибки, без секретов, обрезана в коде до 300 символов.
  error          TEXT        CHECK (error IS NULL OR length(error) <= 500)
);

-- Последний запуск каждой задачи — то, что читает сторож.
CREATE INDEX IF NOT EXISTS ops_job_runs_job_finished_idx
  ON public.ops_job_runs (job, finished_at DESC);
-- Ретенция (старше 30 дней) и свежесть журнала роли для /api/health.
CREATE INDEX IF NOT EXISTS ops_job_runs_finished_idx
  ON public.ops_job_runs (finished_at);

ALTER TABLE public.ops_job_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ops_job_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_job_runs TO service_role;

COMMENT ON TABLE public.ops_job_runs IS
  '154: журнал исходов плановых задач (крон портала и агентов, функции Inngest по расписанию). Только service_role / postgres; RLS без политик; строки старше 30 дней удаляет /api/cron/ops-watchdog.';

NOTIFY pgrst, 'reload schema';
