# Точка А · Фаза 2: движок, конструктор блоков, снимки, событийный пересчёт. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Один расчёт Точки А, который читают все. Расчёт делит баллы на 7 блоков, конфигурация которых настраивается (шаблон → эксперт → клиент). У каждого блока есть достоверность и честное «данных не хватает». Пересчёт запускается событиями с debounce на компанию. Каждый пересчёт сохраняется как снимок с причинами изменений. Новый движок первое время работает в теневом режиме рядом со старым.

**Spec:** `docs/superpowers/specs/2026-10-12-point-a-full-design.md` §2.

**Architecture:**
- Движок v1 (`lib/point-a-engine.ts`) не меняет поведения. Из него только экспортируются проверки по блокам (`pointAChecks`).
- `lib/point-a/v4/` — новый движок поверх этих проверок:
  - покрытие по входам (`CHECK_INPUTS`): незаполненный вопрос не превращается в «0 баллов»;
  - 2 новых блока: «Команда» и «Продукт»;
  - веса из конфигурации, нормировка по блокам с данными, достоверность.
- `lib/point-a/snapshot.ts` `buildPointASnapshot(companyId, opts)`:
  - материализация;
  - v1 и v4;
  - запись строки `diagnostics` (v1 или v4 — по флагу `point_a_v4`);
  - запись снимка `point_a_snapshots` (оба результата, входы, причины изменений);
  - событие `POINT_A_UPDATED`;
  - запуск AI-анализа (у него кэш по хэшу входов).
- `lib/point-a/recalc-queue.ts`:
  - очередь `point_a_recalc_queue`: одна строка на компанию, скользящий `due_at`, атомарный захват;
  - `requestPointARecalc` вызывается из `dispatchEvent` на события данных;
  - разбор очереди — функция Inngest с debounce, если Inngest настроен, и в любом случае ежеминутный `agentsMaintenance`.

**Отличия от спеки (зафиксированы):**
1. **Снимки — отдельная таблица `point_a_snapshots`, а не `diagnostic_sessions.overview`.** У `diagnostic_sessions.overview` уже есть форма `PointAOverview`, её читают отчёты, MCP и Telegram-бот. Другая форма их сломала бы. Теневые расхождения хранятся в том же снимке (поля v1), отдельной `pa_shadow_diffs` нет.
2. **Детерминированная часть пересчитывается полностью** (миллисекунды). Поэтому «инкрементальный» результат совпадает с полным по построению. Инкрементальны дорогие части: материализация идёт по debounce раз на волну событий, AI-анализ перезапускается только при изменении хэша входов.
3. **Библиотека блоков задана кодом** (правила оценки — код). Таблицы — шаблоны `pa_templates` и настройки компании `pa_company_config`. Редактирование библиотеки из GIGA-CRM — фаза 6.
4. **Флаг `point_a_v4` по умолчанию выключен.** Клиент видит v1, а v4 считается в тени. После сравнения в `point_a_snapshots` флаг включает админ.
5. **AI-гипотезы для блоков с нехваткой данных — фаза 2b** (отдельная задача ниже). Они требуют LLM-вызова в асинхронной части.

---

### Task 1: Экспорт проверок из движка v1
- `lib/point-a-engine.ts`: `scoreX(inp)` → `xChecks(inp): Check[]` + `scoreX = toBlock(xChecks(inp))`. `export type PointACheck = Check`; `export function pointAChecks(raw, resolved): Record<V1BlockKey, PointACheck[]>`.
- Тест: для фикстур `CURRENT_FULL_STRONG` и `CURRENT_TYPICAL` `toBlock(pointAChecks(...)[b])` равен `calculatePointA(...).blocks[b]` (поведение не меняется).

### Task 2: Блоки «Команда» и «Продукт» + входы проверок
- `lib/point-a/v4/extra-blocks.ts`:
  - **teamChecks:**
    - `structure_matches` 15 (`s4n_structure_matches`);
    - `delegation` 20 (`s4m_delegation_readiness` 1..10);
    - `owner_ops_hours` 20 (`s4m_hours_on_ops`: ≤4 → 20, ≤8 → 10, иначе 0 + issue);
    - `planning` 10 (`s4m_planning_team_or_solo`);
    - `staffing` 15 (`s4n_staffing_table` с руководителями);
    - `multi_roles` 10 (`s4n_multi_roles` = false);
    - `team_size` 10 (`s1_employee_count` > 0).
  - **productChecks:**
    - `product_line` 10 (`s3_product_count` ≥ 2);
    - `locomotive` 10 (`s5n_product_locomotive` | `s3_flagship_product`);
    - `entry_product` 10;
    - `most_marginal` 10;
    - `moat` 15 (`s3n_cannot_copy`);
    - `nps` 20 (`resolved.nps` | `s7_nps_score`: ≥ 50 → 20, ≥ 0 → 10, < 0 → 0 + issue);
    - `upsell` 10;
    - `measurable_results` 15 (`s3n_measurable_results`).
- `lib/point-a/v4/check-inputs.ts`: `CHECK_INPUTS[block][checkId] = { keys: string[]; resolved?: (keyof PointAResolvedInputs)[]; metrics?: string[] }` для всех проверок 7 блоков. Проверка считается заполненной, если у неё нет `missing` и при этом есть хотя бы один ключ (`present`), resolved-значение или строка таблицы шага 8. `revenue_trend` без данных — не заполнена.
- Тесты: пустые ответы → покрытие 0; заполненный шаг 4 → покрытие команды > 0.6.

### Task 3: Конфигурация блоков
- `lib/point-a/v4/config.ts`:
  - `BLOCK_LIBRARY` (7 блоков: `key`, `title`, `description`, `icon`, `metrics`);
  - `DEFAULT_TEMPLATE`: финансы 0.25, продажи 0.20, операции 0.15, маркетинг 0.12, стратегия 0.10, команда 0.10, продукт 0.08;
  - отраслевые шаблоны `ecommerce`, `services`, `production` (веса из спеки §2.2, сумма 1);
  - `pickTemplate(industry)`;
  - `effectiveBlocks(template, companyConfig)` → `[{ key, weight (нормирован по включённым), enabled, hiddenForClient, order, origin: template|expert|client }]`.
- Правила:
  - эксперт меняет `weight` и `enabled`;
  - клиент меняет `hidden`, `order` и `added`; блок, добавленный клиентом, которого нет в шаблоне, получает вес 0 и `informational`;
  - скрытие клиентом не меняет вес.
- Миграция 111: `pa_templates` (`key` PK, `title`, `industries` text[], `blocks` jsonb, `version`, `updated_at`) с сидом 4 шаблонов; `pa_company_config` (`company_id` PK, `template_key`, `expert_overrides`, `client_view`, `version`, `updated_by`, `updated_at`). RLS: чтение — `can_read_company` или authenticated для шаблонов, запись — только service role.
- `loadBlockConfig(client, companyId)`: строки из БД, а если миграции нет (42P01/PGRST205) — шаблон из кода.
- Тесты: нормировка весов, `informational`, скрытие не меняет итог, выбор шаблона.

### Task 4: Движок v4
- `lib/point-a/v4/engine.ts` `calculatePointAV4({ answers, resolved, blocks: EffectiveBlock[], conflictMetrics?: Set<string> }): PointAV4`.
  - **Блок:**
    - `score` = earned/possible по заполненным проверкам;
    - `coverage` = max заполненных / max всех;
    - `confidence` = coverage × (0.9 − 0.3, если у метрик блока открыт конфликт);
    - `status`: `insufficient_data` при coverage < 0.4 (`score: null`), иначе `ok`;
    - `needs` — тексты `missing` и подсказки «что загрузить» из `CHECK_INPUTS`;
    - `top_issues`, `recommendations`.
  - **Итог:**
    - `overall` = Σ w·score / Σ w по блокам с баллом;
    - `confidence` = Σ w·conf / Σ w по всем включённым;
    - `blocks_without_data`;
    - `health_index`, `stage` — по формулам v1 на блоках v4;
    - `strengths` — блоки и проверки с наибольшим результатом при confidence ≥ 0.6;
    - `upload_checklist` — по ожидаемому приросту покрытия: max пустых проверок × вес блока.
  - `toCompatPointA(v4, v1)` → `PointA`: колонки `diagnostics` (5 блоков + risks/insights/quick_wins/data_gaps из v1) плюс `v4` в `intelligence`.
- Тесты:
  - пустые ответы → `overall` null, все блоки `insufficient_data`;
  - только финансы → `overall` = балл финансов;
  - незаполненное ≠ 0 (v1 даёт 0, v4 исключает);
  - конфликт снижает достоверность;
  - веса эксперта меняют итог, а скрытие клиентом — нет.

### Task 5: Снимок
- Миграция 111 (та же): `point_a_snapshots`:
  - `id`, `company_id`, `diagnostic_id`, `engine` ('v1' | 'v4' — что записано в `diagnostics`), `trigger`, `reasons` text[] (события);
  - `overall`, `confidence`, `blocks` jsonb (v4), `v1_overall`, `v1_blocks` jsonb (тень);
  - `inputs` jsonb (значения метрик и хэши ответов), `inputs_hash`, `config_version`, `change_reasons` jsonb;
  - `created_at`.
  - Индекс `(company_id, created_at desc)`. RLS: чтение — `can_read_company`.
- `lib/point-a/snapshot-diff.ts` `changeReasons(prev, next)`: дельты блоков ≥ 1 балла, изменённые метрики (было → стало, источник, период), число изменённых ответов анкеты (по шагам), смена конфигурации. Чистая функция с тестами.
- `lib/point-a/snapshot.ts` `buildPointASnapshot(companyId, { trigger, reasons, force? })`:
  1. Владелец и `materializeForTenant(service, service, tenant, { announce: false })` (без `METRIC_UPDATED`, иначе цикл).
  2. Открытые расхождения → `conflictMetrics`.
  3. `resolvedInputsFromValues`.
  4. Конфигурация блоков.
  5. v1 и v4.
  6. Флаг `point_a_v4` (реестр настроек).
  7. Если `inputs_hash` и версия конфигурации равны последнему снимку и нет `force` — `{ unchanged: true }`, ничего не пишется.
  8. Иначе запись `diagnostics` (общая функция `insertCurrentDiagnostic` вынесена из `recalculate/route.ts`), снимка, `POINT_A_UPDATED`, `kickPostRecalcJobs` (AI-анализ, Точка Б — как в `recalculate`).
- Тест с подменой ввода-вывода: цепочка вызовов, `unchanged` при тех же входах, `announce: false`.

### Task 6: Очередь пересчёта и подписка на события
- Миграция 111: `point_a_recalc_queue`: `company_id` PK, `reasons` text[], `requested_at`, `due_at`, `started_at`, `attempts`.
- `lib/point-a/recalc-queue.ts`:
  - `requestPointARecalc(companyId, reason, delayMs = 20000)` — upsert: `due_at = now + delay` (скользящий), добавление причины;
  - `claimDue(limit)` — `UPDATE … SET started_at = now() WHERE due_at <= now() AND (started_at IS NULL OR started_at < now() − 10 min) RETURNING`;
  - `finish(companyId, startedAt)` — удаление, если `requested_at <= started_at`, иначе `started_at = null` (нужен ещё проход);
  - `drainPointARecalc({ budgetMs })`.
- `lib/events/platform.ts` `dispatchEvent`: для `POINT_A_TRIGGER_EVENTS` (`SURVEY_ANSWER_CHANGED`, `QUESTIONNAIRE_COMPLETED`, `ONBOARDING_COMPLETED`, `FILE_PROCESSED`, `DOCUMENT_DELETED`, `DISCREPANCY_RESOLVED`, `TARGET_CHANGED`, `BLOCK_CONFIG_CHANGED`, `METRIC_UPDATED`) с `company_id` → `requestPointARecalc`.
- Inngest: функция `point-a-recalc` (`triggers: [{ event: 'point-a/recalc.requested' }]`, `debounce: { key: 'event.data.companyId', period: '20s' }`, `concurrency: { limit: 1, key: 'event.data.companyId' }`) → `drainPointARecalc` для компании; регистрация в `app/api/inngest/route.ts`. `agentsMaintenance` вызывает `drainPointARecalc({ budgetMs: 60000 })`.
- Маршруты удаления документа и решения расхождения больше не вызывают `refreshCompanyDataInBackground`: событие ставит пересчёт, а он материализует данные.
- Тесты на чистую логику очереди (SQL проверяется интеграционно).

### Task 7: Потребители читают сохранённый результат
- `diagnostics/ai-analyze/route.ts:154`, `api/v1/nba/route.ts:128`, `api/clients/[id]/analysis/point-b/route.ts:38` — читают текущую строку `diagnostics` (блоки, риски …) вместо `calculatePointA(answers)`. Если строки нет — прежний расчёт как запасной вариант.
- `ai-analyze`: сортировка по `calculated_at` (колонки `created_at` нет — кэш никогда не срабатывал).
- `recalculate/route.ts` вызывает `buildPointASnapshot(..., { trigger: 'manual', force: true })` и сохраняет прежний контракт ответа.
- Тесты существующих маршрутов обновить.

### Task 8: Флаг и ночной полный пересчёт
- `lib/settings/registry.ts`: `point_a_v4` (boolean, default false, группа «Точка А») и `point_a_auto_recalc` (boolean, default true — выключатель событийного пересчёта).
- Cron Inngest `point-a-nightly` (03:00): компании с анкетой → `requestPointARecalc(id, 'nightly', 0)` порциями; хранение снимков (90 дней, старше — по одному в неделю).

### Task 9 (2b): AI-гипотезы для блоков без данных
- В асинхронной части после снимка: для блоков `insufficient_data`, у которых есть хоть какие-то косвенные входы (coverage > 0), — LLM-оценка через существующий OpenRouter-клиент (`lib/ai`). Результат: `{ score, confidence ≤ 0.4, rationale }`, запись в `point_a_snapshots.blocks[key].hypothesis`. Ключ кэша — хэш входов блока.
- Тесты на сборку промпта и отсечение confidence.

### Task 10: Проверка фазы
- `npx vitest run`, `npx tsc --noEmit`, `npm run lint`; ревью субагентом; применить миграцию 111 после подтверждения.
