-- scripts/ops/inngest-history-prune.sql — чистка истории нашего Inngest (R4-A1, N4A-8).
--
-- Сервер inngest/inngest:v1.52.0 не умеет сам удалять старую историю (флагов ретенции у
-- `inngest start` нет — проверено `inngest start --help`), и база `inngest` на Postgres-sfat
-- растёт (2026-11-16: 33 MB, ~350 запусков в сутки). Этот скрипт удаляет историю старше N дней.
--
-- ЧТО ИЗВЕСТНО О СХЕМЕ. В репозитории схемы сервера Inngest нет (это Go-код сервера, не SDK).
-- Подтверждено только запросами оркестратора к проду (2026-11-15/16):
--   function_runs     (run_id, run_started_at, function_id, …)  — один ряд на запуск;
--   function_finishes (run_id, status, output, …)              — один ряд на завершённый запуск;
--   functions, apps                                              — регистрация (НЕ трогаем).
-- Всё остальное (history, events, traces, spans, …) — НЕ подтверждено: скрипт трогает такую
-- таблицу только с -v include_unconfirmed=1 и только если у неё есть колонка времени именно
-- такого имени и типа timestamp/timestamptz (проверка по information_schema во время запуска);
-- иначе — строка «пропущено» с причиной. Колонки-числа (миллисекунды) не трогаются никогда.
--
-- РЕЖИМЫ (по умолчанию — пробный прогон, ничего не меняет):
--   1. Опись: все таблицы базы, их размер и примерное число строк — смотреть ПЕРЕД первой чисткой.
--   2. Подсчёт: сколько строк каждой кандидатки старше N дней.
--   3. С -v apply=1 — удаление в одной транзакции (lock_timeout 5 с, statement_timeout 5 мин);
--      без него транзакция откатывается.
--   Удаляются только ЗАВЕРШЁННЫЕ запуски (есть строка в function_finishes) старше N дней —
--   идущий или зависший запуск не трогается, даже очень старый.
--
-- ЗАПУСК (только по частной сети, как миграции — через сервис db-tools; база `inngest`, роль с
-- правом DELETE на её таблицы — владелец `inngest`):
--   psql "$INNGEST_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/inngest-history-prune.sql                 # пробно
--   psql "$INNGEST_DB_URL" -X -v ON_ERROR_STOP=1 -v apply=1 -f scripts/ops/inngest-history-prune.sql      # удалить
--   … -v days=60                    другой срок (не меньше 7 дней);
--   … -v include_unconfirmed=1      и неподтверждённые таблицы (после того как опись их показала);
--   … -v allow_db=<имя>             другая база, не `inngest` (только для теста скрипта).
-- После большой чистки место переиспользуется, но не возвращается системе: при желании отдельно
-- `VACUUM (ANALYZE)` (без FULL — FULL блокирует таблицы для сервера Inngest).
-- Порядок и решение о регулярном запуске — docs/ops/README.md, раздел «Чистка истории Inngest».

\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 30
\endif
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?include_unconfirmed}
\else
  \set include_unconfirmed 0
\endif
\if :{?allow_db}
\else
  \set allow_db inngest
\endif

SET prune.days = :'days';
SET prune.apply = :'apply';
SET prune.include_unconfirmed = :'include_unconfirmed';
SET prune.allow_db = :'allow_db';

\echo '== 1. Опись базы (только чтение) =='
SELECT c.relname AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       c.reltuples::bigint AS approx_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY pg_total_relation_size(c.oid) DESC;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

\echo '== 2. Кандидатки и подсчёт; 3. удаление только с -v apply=1 =='
DO $$
DECLARE
  v_days   int     := current_setting('prune.days')::int;
  v_apply  boolean := current_setting('prune.apply') = '1';
  v_extra  boolean := current_setting('prune.include_unconfirmed') = '1';
  v_tz     timestamptz;  -- the cutoff for timestamptz columns
  v_ts     timestamp;    -- the same moment in UTC, for timestamp columns (the server writes UTC)
  v_n      bigint;
  v_type   text;
  c        record;
BEGIN
  IF current_database() <> current_setting('prune.allow_db') THEN
    RAISE EXCEPTION 'inngest-history-prune: база %, ожидалась % (другая база — только с -v allow_db=<имя>)',
      current_database(), current_setting('prune.allow_db');
  END IF;
  IF v_days < 7 THEN
    RAISE EXCEPTION 'inngest-history-prune: days = % — меньше 7 дней не удаляем', v_days;
  END IF;
  v_tz := now() - make_interval(days => v_days);
  v_ts := v_tz AT TIME ZONE 'UTC';
  RAISE NOTICE 'срок: старше % дней (до % UTC), режим: %', v_days, v_ts, CASE WHEN v_apply THEN 'УДАЛЕНИЕ' ELSE 'пробный прогон' END;

  -- ── Подтверждённое: завершённые запуски и их итоги ──────────────────────────
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'function_runs' AND column_name = 'run_started_at';
  IF to_regclass('public.function_runs') IS NULL OR to_regclass('public.function_finishes') IS NULL
     OR v_type IS NULL OR v_type NOT IN ('timestamp without time zone', 'timestamp with time zone')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'function_runs' AND column_name = 'run_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'function_finishes' AND column_name = 'run_id') THEN
    RAISE NOTICE 'пропущено: function_runs(run_id, run_started_at) / function_finishes(run_id) не такие, как подтверждено (run_started_at: %)', coalesce(v_type, 'нет');
  ELSE
    IF v_type = 'timestamp with time zone' THEN
      CREATE TEMP TABLE prune_runs ON COMMIT DROP AS
        SELECT r.run_id FROM public.function_runs r
         WHERE r.run_started_at < v_tz
           AND EXISTS (SELECT 1 FROM public.function_finishes f WHERE f.run_id = r.run_id);
    ELSE
      CREATE TEMP TABLE prune_runs ON COMMIT DROP AS
        SELECT r.run_id FROM public.function_runs r
         WHERE r.run_started_at < v_ts
           AND EXISTS (SELECT 1 FROM public.function_finishes f WHERE f.run_id = r.run_id);
    END IF;
    SELECT count(*) INTO v_n FROM prune_runs;
    RAISE NOTICE 'function_runs + function_finishes: завершённых запусков старше срока — %', v_n;
    IF v_apply AND v_n > 0 THEN
      DELETE FROM public.function_finishes WHERE run_id IN (SELECT run_id FROM prune_runs);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RAISE NOTICE '  удалено из function_finishes: %', v_n;
      DELETE FROM public.function_runs WHERE run_id IN (SELECT run_id FROM prune_runs);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RAISE NOTICE '  удалено из function_runs: %', v_n;
    END IF;
  END IF;

  -- ── Неподтверждённое: только с -v include_unconfirmed=1 и только колонки времени ─
  FOR c IN SELECT * FROM (VALUES
      ('history',    'created_at'),
      ('events',     'received_at'),
      ('traces',     'timestamp'),
      ('spans',      'start_time')) AS t(tbl, col)
  LOOP
    IF to_regclass(format('public.%I', c.tbl)) IS NULL THEN
      RAISE NOTICE 'неподтверждённая %: таблицы нет — пропущено', c.tbl;
      CONTINUE;
    END IF;
    v_type := NULL;
    SELECT data_type INTO v_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col;
    IF v_type IS NULL OR v_type NOT IN ('timestamp without time zone', 'timestamp with time zone') THEN
      RAISE NOTICE 'неподтверждённая %: колонка % (тип %) — не время, пропущено', c.tbl, c.col, coalesce(v_type, 'нет колонки');
      CONTINUE;
    END IF;
    IF v_type = 'timestamp with time zone' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I < $1', c.tbl, c.col) INTO v_n USING v_tz;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I < $1', c.tbl, c.col) INTO v_n USING v_ts;
    END IF;
    RAISE NOTICE 'неподтверждённая %.%: строк старше срока — %', c.tbl, c.col, v_n;
    IF v_n > 0 AND NOT v_extra THEN
      RAISE NOTICE '  не удаляется: нужен -v include_unconfirmed=1 (после проверки описи)';
    ELSIF v_apply AND v_n > 0 THEN
      IF v_type = 'timestamp with time zone' THEN
        EXECUTE format('DELETE FROM public.%I WHERE %I < $1', c.tbl, c.col) USING v_tz;
      ELSE
        EXECUTE format('DELETE FROM public.%I WHERE %I < $1', c.tbl, c.col) USING v_ts;
      END IF;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RAISE NOTICE '  удалено из %: %', c.tbl, v_n;
    END IF;
  END LOOP;
END $$;

\if :apply
  COMMIT;
  \echo '== Изменения сохранены =='
\else
  ROLLBACK;
  \echo '== Пробный прогон: ничего не изменено (удаление — с -v apply=1) =='
\endif
