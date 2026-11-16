# X — наладка после сведения (Раунд 1)

Ветка `claude/multi-agent-portal-dev-8f4869` (поверх dcc00866). Ничего не закоммичено. `scripts/staging/**` — файлы исполнителя S, их я не трогал.

## Итог

| Проверка | До | После |
|---|---|---|
| tsc | 28 ошибок | **0** |
| lint | 0 | **0** |
| vitest, полный прогон | 11 падений в 8 файлах | **2 падения в 2 файлах**: 7949 passed, 14 skipped. Оба — whatsapp-web-bridge, это окружение |
| vt.sh tests/contracts | — | **20/20** |
| next build | — | **exit 0**: проверка типов прошла, 150/150 страниц |

Логи: `~/.a360-test/{tsc,lint,vitest,build}.log`.

## tsc

### 1. TS2554 «Expected 2 arguments» — 20 мест в 6 тестах
- **Корень.** `withDeadline` (`lib/runtime/deadline.ts`, R-015) возвращала `(req, ctx: C) => …`, где `ctx` обязателен, даже если сам обработчик принимает только `req`. Все 4 обёрнутых маршрута (`assistant/analyze`, `diagnostics/ai-analyze`, `point-b/ai-generate`, `documents`) — статические, их `handlePost(req)` второго аргумента не принимает.
- **Исправление.** Добавил перегрузки:
  - обработчик `(req)` → обёртка `(req, ctx?: unknown)`;
  - обработчик `(req, ctx)` → `ctx` остаётся обязательным, поэтому динамический маршрут не потеряет `{ params }`.
- **Совместимость с Next.** Проверил по шаблону `next-types-plugin` (14.2.35): `SecondArg<…>` для `unknown` даёт `any`, такая сигнатура проходит. `next build` прошёл этап «Checking validity of types».
- Тесты не менялись.

### 2. `middleware.ts(385)`: `resolved.unknown`
- **Корень.** Тернарник `profile ? roleAndStatusFrom(...) : await resolveRoleAndStatus(...)`. При выводе типа TS сводил объединение к `{role, status}`, и признак `unknown` из R-140 из типа пропадал.
- **Исправление.** Ввёл тип `ResolvedProfile = { role; status; unknown?: true }`. Его возвращают обе функции, им же типизирован `resolved`.
- **Логика проверена.** Ошибка или таймаут чтения → `unknown: true` → на защищённых страницах ответ 503 «Временная ошибка», публичные страницы и страницы входа проходят. Если строки профиля нет (`data = null`, без ошибки), признак не ставится и поведение прежнее.

### 3. `scripts/demo-sau-zhurek.ts(95)`
`estimated_revenue_kzt: number | null`. При `null` скрипт выводит «нет данных о среднем чеке», как это уже делают `pdf-strategy` и `xlsx-call-list`.

### 4. TS2769 в `hermetic-test-env.test.ts:220` и `backup.test.ts:167`
- **Корень.** Next объявляет `ProcessEnv.NODE_ENV` обязательным, а дочерним процессам передаётся урезанное env без него.
- **Исправление.** Добавил `NODE_ENV: 'test'`, как уже сделано в `tests/unit/infra/predeploy.test.ts`. Ни `setup.mjs`, ни `railway-db-backup.sh` эту переменную не читают.

## Новые падения vitest

### 5. `diagnostic-pipeline.test.ts` — 4 теста. Тест верный, сломалось окружение теста
- **Корень.** После R-034 `scoring.ts` получает балл только через официальный `buildPointASnapshot`. Тот читает и пишет через Supabase service client, а в герметичном прогоне Supabase недоступен («snapshot read failed ()»). Шаг metrics падал с `PointAUnavailableError`, и цепочка стадий обрывалась. Это третий шаг конвейера, работающий через Supabase, но шва для тестов (`setDiagnosticsIO`) у него не было: R-034 обновил `diagnostics-fixes`, а этот тест забыл.
- **Исправление в коде.**
  - `lib/diagnostics/io.ts`: в `DiagnosticsIO` добавлен `snapshot(companyId)`. По умолчанию вызывается тот же `buildPointASnapshot` с прежними опциями.
  - `scoring.ts`: `prismaIO.snapshot` теперь идёт через `diagnosticsIO()`.
  - Поведение в проде не меняется.
- **Исправление в тесте.** Тест подставляет `snapshot`, который ведёт себя как официальный:
  - пишет текущую строку `diagnostics`, если её нет;
  - если строка есть, отвечает «unchanged»;
  - если ответов нет, отвечает «no_answers».
- **Что проверяет тест и почему его утверждения оставлены.** Порядок стадий, одна сессия на компанию, повторное использование балла (тот же `diagnostic_id`, одна строка diagnostics), запуск без ключа модели. Это поведение конвейера, а не v1-балл по неполной анкете, поэтому ни одно утверждение не ослаблял. Сами правила балла R-034 покрывает `tests/unit/diagnostics/scoring-official.test.ts`.

### 6. `e2e-auth-seam.test.ts`
Код прав: по R-002 персонал определяется только по `staff_roles`, а E2E-сид `tests/e2e/giga-seam.ts` эту строку выдаёт. Тест приведён к новому правилу:
- `super_admin` со строкой в staff_roles → проходит;
- профиль `super_admin` без строки в staff_roles → `null` (добавлен отдельный кейс).

## Падения, бывшие до раунда

Три оказались ошибками тестов, исправлены:
- **`agent-runtime-fixes`, бюджет.** Шпион `fetch` считал ещё и чтение `system_settings` через Supabase REST: 3 вызова вместо 1. Теперь считаются только вызовы `/chat/completions`. Сама логика бюджета работала верно: dead + succeeded, резерв снят.
- **`report-agent`, «без ключа модели».** Шпион ловил загрузку PDF в Storage (`/storage/v1/object/report-pdfs/`). Теперь тест проверяет, что других сетевых вызовов, кроме этой загрузки, нет.
- **`integration-connections`, сдвиг на день.** Тестовый PostgREST-клиент `tests/integration/db/metrics-pg-client.ts` превращал DATE в `Date` на локальную полночь, а затем в ISO. В поясе +05 это давало предыдущий день, хотя PostgREST отдаёт строку `YYYY-MM-DD`. Для типа DATE (OID 1082) теперь возвращается исходная строка, через `types` у отдельного запроса.
- **`diagnostics-fixes`, сортировка.** Это не баг кода: на macOS libc-локаль `en_US.UTF-8` сортирует кириллицу в обратном порядке (проверено в psql). В тесте теперь `ORDER BY title COLLATE "C"`.

Не исправлены, это окружение:
- **`whatsapp-web-bridge-pull-control` и `whatsapp-web-bridge-reliability`.** В `services/whatsapp-web-bridge/` не установлен пакет `baileys` (`ERR_MODULE_NOT_FOUND`). Без загрузки пакетов это не исправить: нужен `npm ci` в этой папке.

## next build

- Сборка прошла, падений нет.
- Предупреждения были и до раунда, на результат не влияют:
  - ключ `turbopack` в `next.config.mjs` (Next 14 его не знает);
  - critical dependency в `@vercel/queue`;
  - лог «Dynamic server usage» у `/api/v1/metrics/catalog`: `catch` логирует служебную ошибку пререндера, маршрут собран как ƒ (динамический). Исправляется строкой `export const dynamic = 'force-dynamic'`, но маршрут в раунде не менялся, поэтому я его не трогал.
- Импортов server-only из клиентских компонентов сборка не выявила.

## Открыто, вне моей задачи
- `middleware.ts` (страницы ГИГА, примерно строка 520) по-прежнему пускает профиль `super_admin` без строки в `staff_roles`. Страница откроется, а API ответит 401/403. Расхождение с R-002 отметил ещё I1. Выровнять стоит отдельной правкой.
- Перед выкатом проверить на проде (только чтение), что у владельца ГИГА есть строка `staff_roles` со значением `super_admin` (см. I1.md, п. 4).

## Изменённые файлы
`lib/runtime/deadline.ts`, `lib/diagnostics/io.ts`, `lib/diagnostics/scoring.ts`, `middleware.ts`, `scripts/demo-sau-zhurek.ts`, `tests/contracts/hermetic-test-env.test.ts`, `tests/integration/db/{backup,diagnostic-pipeline,diagnostics-fixes,agent-runtime-fixes,report-agent}.test.ts`, `tests/integration/db/metrics-pg-client.ts`, `tests/unit/admin/e2e-auth-seam.test.ts`.
