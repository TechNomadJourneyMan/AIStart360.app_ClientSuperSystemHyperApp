# Перенос портала на Railway — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** портал `portal.aistart360.app` работает на Railway одним постоянным сервером. Код при этом продолжает работать на Vercel, пока тот остаётся запасным.

**Architecture:** включается режим «постоянный сервер» (`PERSISTENT_SERVER=1`), только на Railway. Он:
- разрешает фоновую работу после ответа;
- запускает из `instrumentation.ts` планировщик задач по расписанию и очередь Vercel Workflow на Postgres Railway;
- при SIGTERM дожидается начатой фоновой работы.

Секреты переносятся разовой сборкой Vercel прямо в Railway. Домен переключается последним шагом, только по «да» PO.

**Tech Stack:** Next.js 14.2.35, TypeScript, Vitest, `workflow` 4.8.9 + `@workflow/world-postgres` 4.3.x, `croner`, `geoip-country`, Railway (Railpack, config-as-code), Vercel CLI 59.

**Spec:** `docs/superpowers/specs/2026-11-02-railway-migration-design.md`

## Global Constraints

- **Vercel.** Без `PERSISTENT_SERVER=1` поведение на Vercel не меняется ни в чём.
- **Тексты.** Весь текст для пользователя — по-русски. Гри не трогать.
- **Тесты и `.env.local`.** Никогда не создавать `.env.local` в рабочем каталоге перед `npm test` и сборкой: локальное окружение указывает на продовую базу. Интеграционные тесты — только с `TEST_DATABASE_URL`.
- **Коммиты и пуши.** Только когда PO попросит. Деплой на Railway в тестовый период — через `railway up` из рабочего каталога, без коммита.
- **Секреты.** Значения не печатаются, не пишутся на диск и в git, не попадают в чат и логи. Логировать можно только имена переменных.
- **Только после «да» PO:**
  - перенос секретов (Task 9, шаг 3);
  - переключение домена (Task 11).
- **Регион Railway** — `europe-west4-drams3a`, одна копия, draining 60 с.
- **Фоновые задачи:** не дольше 45 с, параллельно не больше 2 (правило после инцидента 504 2026-10-15).
- **Расписание** — в UTC, как у Vercel Cron.
- **Проверки перед готовностью:**
  - `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`;
  - `npm run lint`;
  - `npm test`;
  - `npm run build`.

## Review Focus

- **Перезапуск сервера в ту же минуту, когда задача уже сработала.** Задача не должна выполниться второй раз (дубль дайджеста). Правило: в минуту запуска процесса планировщик ничего не запускает. Тест — Task 4.
- **Многострочные значения переменных** (ключи с переводами строк) и пустые значения при переносе секретов. Многострочное значение переносится без искажений, пустое пропускается и считается в отчёте. Значения никогда не печатаются. Тест — Task 8.
- **Деплой во время подвисания Supabase.** Проверка здоровья Railway не должна зависеть от базы. Тест — Task 3.
- **SIGTERM посреди долгой фоновой работы.** Сервер ждёт её до 55 с, потом всё равно завершается. Тест — Task 1.
- **IP посетителя.** Для валюты берётся `x-real-ip`, иначе первый адрес из `x-forwarded-for`. Частные и локальные адреса — «страна неизвестна» → ₸. Тест — Task 6.

---

### Task 1: Режим «постоянный сервер» и фоновая работа

**Files:**
- Create: `lib/runtime/platform.ts`
- Modify:
  - `lib/background.ts`
  - `lib/telegram/bots/defer.ts`
  - `app/api/webhooks/meta/route.ts:95-110`
  - `app/api/webhooks/whatsapp-web/route.ts:106-125`
  - `lib/omnichannel/telegram-ingest.ts:83-100`
  - `lib/point-a/recalc-queue.ts:57-66`
- Test:
  - `tests/unit/infra/platform.test.ts`
  - `tests/unit/infra/background.test.ts`
  - `tests/unit/telegram/defer.test.ts`

**Interfaces:**
- Produces:
  - `isPersistentServer(env?: NodeJS.ProcessEnv): boolean` — `env.PERSISTENT_SERVER === '1'`.
  - `canRunAfterResponse(env?: NodeJS.ProcessEnv): boolean` — `env.VERCEL === '1' || isPersistentServer(env)`.
  - `trackBackground(promise: Promise<unknown>): void` (`lib/background.ts`). Регистрирует промис в наборе незавершённой работы и в Vercel `waitUntil`, если есть контекст запроса. Промис убирается из набора, когда завершится.
  - `pendingBackgroundCount(): number`.
  - `waitForBackgroundWork(timeoutMs: number): Promise<{ finished: boolean; pending: number }>`.
  - `runInBackground` (существующая) использует `trackBackground`.

- [ ] **Step 1: Тесты**
  - `platform.test.ts`:
    - `canRunAfterResponse({VERCEL:'1'})` → true;
    - `({PERSISTENT_SERVER:'1'})` → true;
    - `({})` → false;
    - `({PERSISTENT_SERVER:'0'})` → false.
  - `background.test.ts`:
    - два `trackBackground` с промисами 10 и 50 мс → `pendingBackgroundCount()` = 2;
    - `waitForBackgroundWork(1000)` → `{finished:true, pending:0}`;
    - промис, который не завершается, и `waitForBackgroundWork(30)` → `{finished:false, pending:1}`;
    - отклонённый промис не роняет `waitForBackgroundWork`.
  - `defer.test.ts`:
    - `vi.stubEnv('PERSISTENT_SERVER','1')`. Работа — промис, который завершится через 50 мс. `deferOrAwait` возвращает `'deferred'` быстрее 20 мс, а работа попадает в `pendingBackgroundCount()`;
    - без флага возвращает `'awaited'` только после завершения работы (как сейчас).
- [ ] **Step 2:** `npx vitest run tests/unit/infra/platform.test.ts tests/unit/infra/background.test.ts tests/unit/telegram/defer.test.ts` — FAIL (нет модулей и функций).
- [ ] **Step 3: Реализация**
  - Создать `lib/runtime/platform.ts`.
  - Добавить в `lib/background.ts` набор `Set<Promise>`, `trackBackground`, `pendingBackgroundCount`, `waitForBackgroundWork`.
  - В `deferOrAwait`: если `hasWaitUntil()` — как сейчас; иначе если `isPersistentServer()` — `trackBackground(safe)` и `'deferred'`; иначе `await`.
  - В четырёх местах `if (process.env.VERCEL !== '1') return` заменить на `if (!canRunAfterResponse()) return`. Там, где вызывается `waitUntil(work)` в try/catch, заменить на `trackBackground(work)`.
- [ ] **Step 4:** тесты из шага 2 — PASS. Затем `npx vitest run tests/unit/telegram tests/unit/omnichannel tests/unit/point-a` — PASS. Существующие тесты не должны поменять поведение без флага.

### Task 2: Адрес внутренних вызовов

**Files:**
- Modify: `lib/internal-auth.ts:129-147`
- Test: `tests/unit/security/internal-auth.test.ts`

**Interfaces:**
- Produces: `internalBaseUrl()` первым берёт `INTERNAL_BASE_URL`, затем прежний порядок: `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → null в production.

- [ ] **Step 1: Тест**
  - `vi.stubEnv('INTERNAL_BASE_URL','http://127.0.0.1:8080/')` при заданных `NEXT_PUBLIC_APP_URL` и `VERCEL_URL` → `'http://127.0.0.1:8080'`;
  - без `INTERNAL_BASE_URL` прежние случаи не меняются.
- [ ] **Step 2:** `npx vitest run tests/unit/security/internal-auth.test.ts` — FAIL.
- [ ] **Step 3: Реализация** — одна ветка в начале функции, тот же trim и срезание `/`. Комментарий над функцией дополнить: постоянный сервер ходит к себе по localhost.
- [ ] **Step 4:** тест — PASS.

### Task 3: Проверка жизни без базы

**Files:**
- Create: `app/api/healthz/route.ts`
- Test: `tests/unit/api/healthz-route.test.ts`

**Interfaces:**
- Produces: `GET /api/healthz` → 200 `{ ok: true, uptimeS: number }`, `Cache-Control: no-store`. Без базы, без авторизации (middleware пропускает `/api/*`), `dynamic = 'force-dynamic'`.

- [ ] **Step 1: Тест** — `GET()` → status 200, `json.ok === true`, `uptimeS` — число ≥ 0. Модуль не импортирует `@/lib/supabase*`, `@/lib/db` или `@/lib/health*`: проверить чтением исходника.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
- [ ] **Step 4:** PASS.

### Task 4: Расписание и планировщик

**Files:**
- Create:
  - `lib/cron/schedule.ts`
  - `lib/cron/runner.ts`
- Modify: `package.json` — добавить `croner` 11.x, точная версия.
- Test:
  - `tests/unit/cron/schedule.test.ts`
  - `tests/unit/cron/runner.test.ts`

**Interfaces:**
- Produces:
  - `interface CronJob { path: string; schedule: string }`
  - `CRON_JOBS: readonly CronJob[]` — те же 9 записей, что сейчас в `vercel.json`.
  - `dueJobs(minute: Date, jobs?: readonly CronJob[]): CronJob[]` — задачи, чьё выражение совпадает с этой минутой в UTC.
  - `startCronRunner(opts: { baseUrl: string; secret: string; startedAt?: Date; fetchImpl?: typeof fetch; now?: () => Date; setTimer?: typeof setTimeout; log?: (line: string) => void }): { stop(): void }`.
    - Тикает на границе каждой минуты.
    - На каждую задачу из `dueJobs` вызывает `GET {baseUrl}{path}` с `Authorization: Bearer {secret}`, не больше 2 одновременно.
    - Каждую минуту запускает не больше одного раза.
    - **Ничего не запускает в минуту `startedAt`.**
    - Пишет в лог путь, статус и время. Секрет в лог не попадает.

- [ ] **Step 1: Тесты**
  - `schedule.test.ts`: пока Vercel выполняет задачи, `CRON_JOBS` равен массиву `crons` из `vercel.json` (порядок не важен).
  - `runner.test.ts`, `dueJobs`:
    - `2026-11-02T04:00:00Z` (понедельник) → `/api/cron/crm-digest`, `/api/cron/agents-digest`, `/api/cron/client-digest`;
    - `2026-11-03T04:00:00Z` → те же без `client-digest`;
    - `04:01Z` → пусто;
    - `00:15Z` → `billing-expiry`.
  - `runner.test.ts`, `startCronRunner` (fake timers, fake fetch):
    - `startedAt = 03:59:30Z`, время доходит до 04:00:00 → три вызова с заголовком `Bearer s3cr3t`;
    - `startedAt = 04:00:10Z` → в 04:00 вызовов нет;
    - строки лога не содержат `s3cr3t`;
    - `stop()` останавливает тики.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация** — `croner` используется для сопоставления выражений: `new Cron(expr, { timezone: 'UTC', paused: true }).match(date)` или аналог из его API. Таймер — `setTimeout` до следующей границы минуты, пересчёт на каждом тике (без дрейфа `setInterval`).
- [ ] **Step 4:** PASS.

### Task 5: Запуск постоянного сервера

**Files:**
- Create:
  - `instrumentation.ts`
  - `lib/runtime/server-start.ts`
  - `scripts/railway/predeploy.mjs`
- Modify:
  - `next.config.mjs` — `experimental.instrumentationHook: true`;
  - `package.json` — `@workflow/world-postgres` 4.3.x, совместимый с `workflow` 4.8.9 (`@workflow/world` 4.5.x).
- Test: `tests/unit/infra/server-start.test.ts`

**Interfaces:**
- Consumes:
  - `isPersistentServer` (Task 1);
  - `waitForBackgroundWork` (Task 1);
  - `startCronRunner` (Task 4).
- Produces: `startPersistentServer(env: NodeJS.ProcessEnv, deps?: { startWorld?: () => Promise<void>; startCron?: typeof startCronRunner; onSignal?: (sig: 'SIGTERM'|'SIGINT', handler: () => void) => void; exit?: (code: number) => void; log?: (line: string) => void }): Promise<{ world: boolean; cron: boolean }>`.
  - **Очередь Workflow.** Запускается, только если `WORKFLOW_TARGET_WORLD === '@workflow/world-postgres'`. Делается через `getWorld().start?.()` из `workflow/runtime`.
  - **Планировщик.** Запускается, только если `CRON_RUNNER_ENABLED === '1'` и задан `CRON_SECRET`. Адрес — `http://127.0.0.1:${PORT || 3000}`. Если `CRON_SECRET` нет — строка в лог, планировщик не стартует.
  - **Сигналы.** На SIGTERM и SIGINT: `waitForBackgroundWork(55_000)`, лог «ждали N задач», `exit(0)`.
- `instrumentation.ts`: `register()` выходит сразу, если `NEXT_RUNTIME !== 'nodejs'` или `!isPersistentServer()`. Иначе выполняет динамический `import('./lib/runtime/server-start')` и `startPersistentServer(process.env)`.
- `scripts/railway/predeploy.mjs`: если `WORKFLOW_TARGET_WORLD` — postgres-мир, запускает `bootstrap` пакета `@workflow/world-postgres` (команда из `node_modules/workflow/docs/deploying/world/postgres-world.mdx`). Иначе печатает «пропуск» и выходит с 0.

- [ ] **Step 1: Тест** (`server-start.test.ts`, все зависимости — заглушки)
  - пустое окружение → `{world:false, cron:false}`, сигналы не регистрируются;
  - `{PERSISTENT_SERVER:'1', WORKFLOW_TARGET_WORLD:'@workflow/world-postgres', CRON_RUNNER_ENABLED:'1', CRON_SECRET:'x', PORT:'8080'}` → `startWorld` вызван, `startCron` вызван с `baseUrl 'http://127.0.0.1:8080'`;
  - `CRON_RUNNER_ENABLED:'1'` без `CRON_SECRET` → `cron:false`, в логе предупреждение;
  - вызов зарегистрированного SIGTERM-обработчика → `exit(0)` после ожидания.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.** Установить зависимость. Проверить версии: `npm ls @workflow/world @workflow/world-postgres`. Две несовместимые копии `@workflow/world` недопустимы.
- [ ] **Step 4:** PASS. Затем `npm run build` — сборка проходит, `instrumentation` присутствует в `.next/server`.

### Task 6: Валюта на главной без заголовка Vercel

**Files:**
- Create:
  - `lib/geo/country.ts`
  - `lib/geo/currency.ts`
- Modify: `app/page.tsx:102-127` — `GEO_CURRENCIES` и `resolveGeoCurrency` переезжают в `lib/geo/currency.ts`.
- Modify: `package.json` — `geoip-country`, точная версия.
- Test: `tests/unit/geo/country-currency.test.ts`

**Interfaces:**
- Produces:
  - `countryFromHeaders(h: { get(name: string): string | null }, lookup?: (ip: string) => string | null): string | null`.
    - `x-vercel-ip-country`, если есть.
    - Иначе IP из `x-real-ip` или первый адрес из `x-forwarded-for`, затем `lookup`. По умолчанию — `geoip-country`.
    - Частные, локальные и некорректные адреса → null.
  - `currencyForCountry(country: string | null): GeoCurrency` — KZ/null → KZT, RU/BY → RUB, остальные → USD.

- [ ] **Step 1: Тесты**
  - заголовок Vercel `'ru'` → `'RU'`, `lookup` не вызывается;
  - `x-forwarded-for: '5.34.0.1, 10.0.0.1'` и `lookup` → `'KZ'`: в `lookup` передан `'5.34.0.1'`;
  - `x-real-ip: '10.1.2.3'` → null;
  - `currencyForCountry`: null → KZT, `'BY'` → RUB, `'DE'` → USD.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.** `app/page.tsx` вызывает `currencyForCountry(countryFromHeaders(headers()))`, остальное на странице не меняется. Перед выбором `geoip-country` проверить его рост памяти: `node -e` с `process.memoryUsage().rss` до и после загрузки. Допустимо до 40 МБ. Если больше — взять пакет с ленивой загрузкой и записать это в сообщение коммита.
- [ ] **Step 4:** PASS.

### Task 7: Конфигурация Railway

**Files:**
- Create: `railway.json` (корень репозитория)
- Test: `tests/unit/infra/railway-config.test.ts`

**Interfaces:**
- Produces: `railway.json`:
  - `build.builder: "RAILPACK"`, `build.buildCommand: "npm run build"`;
  - `deploy.startCommand: "node node_modules/next/dist/bin/next start -H 0.0.0.0"` (`PORT` Next берёт сам);
  - `deploy.preDeployCommand: ["node scripts/railway/predeploy.mjs"]`;
  - `deploy.healthcheckPath: "/api/healthz"`, `deploy.healthcheckTimeout: 300`;
  - `deploy.restartPolicyType: "ON_FAILURE"`;
  - `deploy.drainingSeconds: 60`;
  - `deploy.multiRegionConfig: { "europe-west4-drams3a": { "numReplicas": 1 } }`.

- [ ] **Step 1: Тест** — читает `railway.json` и проверяет:
  - `healthcheckPath === '/api/healthz'`;
  - `drainingSeconds >= 60`;
  - `startCommand` начинается с `node ` и не содержит `npm`;
  - единственный регион — `europe-west4-drams3a`, `numReplicas` = 1.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** создать файл. Если сборка Railpack на Railway упрётся в память — добавить `NODE_OPTIONS=--max-old-space-size=6144` переменной сервиса, а не в файл.
- [ ] **Step 4:** PASS. Затем общий прогон проверок из Global Constraints.

### Task 8: Скрипт переноса секретов

**Files:**
- Create:
  - `scripts/railway/push-env.mjs`
  - `scripts/railway/env-sync/README.md` — как собрать временную папку для разовой сборки
- Test: `tests/unit/infra/push-env.test.ts`

**Interfaces:**
- Produces (экспорт из `push-env.mjs` для тестов):
  - `selectVariables(env: Record<string,string|undefined>, names: string[]): { variables: Record<string,string>; skippedEmpty: string[]; missing: string[] }`.
    - Исключает имена с префиксами `VERCEL`, `TURBO_` и `NX_DAEMON`.
    - Значения не меняет.
  - `buildUpsertBody(ids: { projectId; environmentId; serviceId }, variables): { query: string; variables: object }` — мутация `variableCollectionUpsert` с `replace: false` и `skipDeploys: true`.
  - `main()`:
    - читает `names.json` (имена переменных Vercel Production, без значений) и `RAILWAY_ENV_SYNC_TOKEN` и ID из `railway-target.json`;
    - отправляет `POST https://backboard.railway.com/graphql/v2` с заголовком `Project-Access-Token`;
    - печатает только количество перенесённых, список имён из `skippedEmpty` и `missing`;
    - **всегда завершается с кодом 1**: при успехе с текстом «Перенос завершён, сборка остановлена намеренно», при сбое — без значений в тексте.

- [ ] **Step 1: Тесты**
  - многострочное значение `'-----BEGIN\nabc\n-----END'` переносится байт в байт;
  - `''` попадает в `skippedEmpty`;
  - `VERCEL_URL` и `TURBO_CACHE` исключены;
  - отсутствующее имя попадает в `missing`;
  - тело запроса содержит `replace: false` и `skipDeploys: true`;
  - **текст отчёта не содержит ни одного значения** (проверить строкой-маркером в значении).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация** — модуль на ESM, без зависимостей, Node 20+. В `README.md` описать временную папку:
  - `vercel.json` с `{"buildCommand":"node push-env.mjs","framework":null,"installCommand":""}`;
  - `push-env.mjs`;
  - `names.json`;
  - `railway-target.json` (только ID, не секреты).
- [ ] **Step 4:** PASS.

### Task 9: Проект Railway и тестовый деплой (операции)

**Files:** нет (операции через Railway MCP/CLI и Vercel CLI).

- [ ] **Step 1: Проект.** Создать проект `aistart360-portal` в рабочем пространстве «TNJM's Projects»:
  - сервис `portal` — пустой, источник задаётся через `railway up`;
  - базу Postgres `workflow-db`.
  
  Ожидание: `list-services` показывает оба сервиса в `production`.
- [ ] **Step 2: Несекретные переменные `portal`:**
  - `PERSISTENT_SERVER=1`;
  - `CRON_RUNNER_ENABLED=0`;
  - `INTERNAL_BASE_URL=http://127.0.0.1:${{PORT}}` — или явный порт `8080` вместе с `PORT=8080`;
  - `NEXT_MANUAL_SIG_HANDLE=true`;
  - `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`;
  - `WORKFLOW_POSTGRES_URL=${{workflow-db.DATABASE_URL}}`;
  - `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60`;
  - `RAILPACK_NODE_VERSION` — та же основная версия, что у прод-деплоймента Vercel (`vercel inspect` последнего production-деплоймента).
- [ ] **Step 3: Перенос секретов. СТОП: спросить PO «да» на перенос секретов.** После «да»:
  1. Создать токен проекта Railway для окружения `production` (GraphQL `projectTokenCreate` или панель).
  2. Записать `RAILWAY_ENV_SYNC_TOKEN` в Vercel (Production, sensitive) через `vercel env add`, значение передать через stdin, не через аргумент.
  3. Собрать временную папку по `scripts/railway/env-sync/README.md`. `names.json` — из `vercel env ls production`, только имена.
  4. Запустить `vercel deploy --prod --skip-domain --yes` в проекте `aistart360app-portal`.
  5. В логе сборки найти «Перенос завершён». Сборка должна упасть, деплоймента нет.
  6. Удалить `RAILWAY_ENV_SYNC_TOKEN` из Vercel и отозвать токен Railway.
  
  Ожидание: `list-variables` для `portal` содержит все имена из `names.json` за вычетом системных и пустых.
- [ ] **Step 4: Деплой.** `railway up --service portal --detach` из рабочего каталога ветки. Дождаться сборки. Ожидание:
  - `/api/healthz` 200 на выданном адресе `*.up.railway.app`;
  - в логах есть строка запуска очереди Workflow и нет ошибок `bootstrap`.
- [ ] **Step 5: Проверка тестового адреса.**
  - Автоматически: `/`, `/login`, `/api/health`, `/api/og/gri`, `/api/v1/point-a/state` (401).
  - Вручную, вместе с PO: вход по паролю, `/client/home`, Точка А с пересчётом, Точка Б, дашборды GIGA, запуск агента, OCR документа.
- [ ] **Step 6: Замер.** Медиана из 10 запросов для публичных страниц и API, Vercel и Railway, одинаковые запросы. Если Railway медленнее больше чем на 30 % — остановиться и обсудить с PO. Результат записать в спеку, §7.

### Task 10: PR в main

- [ ] **Step 1:** по просьбе PO — коммит Task 1–8, пуш ветки `claude/railway-migration`, PR в `main`. В описании:
  - что меняется на Vercel: ничего без `PERSISTENT_SERVER`;
  - ссылка на спеку;
  - результаты замера.
- [ ] **Step 2:** после мержа переключить источник сервиса `portal` на GitHub, ветка `main` (`connect-service-source`). Дождаться, что деплой из `main` проходит.

### Task 11: Переключение домена — СТОП: только после «да» PO и согласованного времени

- [ ] **Step 1: Домен в Railway.** Добавить `portal.aistart360.app` как свой домен сервиса `portal`, получить цель CNAME и требования к проверке.
- [ ] **Step 2: Коммит «crons → Railway».**
  - Удалить `crons` из `vercel.json`, регион оставить.
  - `tests/unit/infra/vercel-region.test.ts`: crons отсутствуют.
  - `schedule.test.ts`: `CRON_JOBS` содержит 9 путей, `vercel.json` их больше не содержит.
  
  Затем пуш, мерж, прод-деплой Vercel — Ready.
- [ ] **Step 3: Включить задачи на Railway.** `CRON_RUNNER_ENABLED=1` в `portal`, передеплой. Шаги 2 и 3 — подряд, без задач по расписанию между ними. Ближайшая задача в UTC: `22:00` / `00:15` / `01:30`.
- [ ] **Step 4: DNS.**
  1. `vercel domains rm portal.aistart360.app` из проекта `aistart360app-portal` (снять привязку, не удалять зону).
  2. `vercel dns add aistart360.app portal CNAME <цель Railway>` (+ TXT, если нужен).
  3. Дождаться сертификата на Railway (`domain-status`).
- [ ] **Step 5: Проверки.**
  - `PUT https://portal.aistart360.app/api/inngest` (пересинхронизация).
  - Inngest Cloud: функции зарегистрированы.
  - `getWebhookInfo` ботов Telegram — без ошибок.
  - Мост WhatsApp — `commands/claim` отвечает 200.
  - `/api/health` — 200.
- [ ] **Step 6: Наблюдение сутки** (логи Railway):
  - 5xx;
  - срабатывания задач по расписанию: ровно одно на каждое время;
  - запуски Workflow и Inngest.
- [ ] **Step 7: Через 7 дней стабильной работы** спросить PO, можно ли отключить у проекта Vercel сборки из git. Деплойменты не удалять: на них дорабатывают потоки Workflow, начатые до переключения.

**Откат:**
1. Вернуть домен в Vercel, удалить CNAME.
2. Вернуть crons в `vercel.json` (revert коммита шага 2).
3. На Railway `CRON_RUNNER_ENABLED=0`.
4. Пересинхронизировать Inngest.
