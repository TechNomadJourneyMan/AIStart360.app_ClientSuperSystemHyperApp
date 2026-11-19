# Выкатка портала: runbook

Как выкатывать портал AIStart360 на Railway, как проверять и откатывать. Раунд 4, пакет R4-A4: закрывает R-019, N4A-6 и документ по R-020 аудита `docs/audit-2026-11/R4-AUDIT-A.md`. Описан порядок, по которому выкатывали Раунды 1–4, и скрипты, которые его проверяют.

| Что | Где |
|---|---|
| Проверки перед выкаткой и план команд | `scripts/deploy/preflight.mjs` (`npm run deploy:preflight -- …`); `--env staging` — что применено к staging-базе |
| Пакет миграций для `db-tools` | `scripts/deploy/migrations-bundle.mjs` |
| Smoke после выкатки, только чтение | `scripts/smoke/post-deploy.mjs` (`npm run smoke:prod`) |
| Номера и откаты миграций в CI | `scripts/deploy/check-migrations.mjs`, шаг в `.github/workflows/ci.yml` |
| Что выкачено | `GET /api/healthz` → `deploymentId`, `commit` |
| Откаты миграций | `supabase/migrations/rollback/NNN_*.down.sql` (с 140 — у каждой миграции) |
| Настройки сервисов Railway, `railway.json` | [railway-config.md](railway-config.md), §13 ниже |
| Тревоги и сторожа | [docs/ops/README.md](../ops/README.md) |
| Бэкапы и восстановление | [docs/backup/README.md](../backup/README.md) |
| Staging (база и Supabase; кода там нет) | [docs/staging/README.md](../staging/README.md) |
| Вход для разработки на localhost | [docs/dev-login.md](../dev-login.md) |
| Закрыть регистрацию в GoTrue | §15 ниже |
| Клиентский Telegram-бот: секрет вебхука | §16 ниже |

Скрипты ничего не выкатывают сами. `preflight` проверяет и печатает команды. `migrations-bundle` собирает пакет и печатает команды. `smoke` только читает. Каждую команду из плана человек запускает сам, по одной, и смотрит на вывод.

Обозначения: `<project>` — проект портала в Railway (выбирается `railway link`), `<deploy-dir>` — отдельная чистая копия репозитория для выкатки, `<tools-dir>` — вторая копия на свежем `main`, из неё запускаются скрипты при откате (§9), `<label>` — имя выкатки (`round4w3`), `<staging-dsn>` — строка подключения к staging-базе из файла `addr` и пароля (docs/staging/README.md). Сервисы называются по именам: `portal`, `agents`, `db-tools`, `inngest`, `workflow-db`. Значения переменных Railway не смотреть и не печатать, только имена.

## 1. Порядок

```
«да» PO ─► миграции на staging-БД ─► локальная проверка кода против staging (коммит V)
        ─► PR ─► зелёный CI ─► merge в main ─► CI по merge-коммиту M зелёный
        ─► preflight (prod, --verified V) ─► бэкап ─► миграции прод ─► railway up portal + agents (M)
        ─► PUT /api/inngest ─► smoke ─► через 15–20 мин журнал ops_job_runs ─► отчёт выкатки
```

**Staging — это база, а не деплой.** В окружении `staging` на Railway живут база и Supabase. У сервисов `portal` и `agents` там нет ни одного деплоя (проверено 2026-11-17). Код до прода проверяется **локально**: `next dev` с `.env.local`, который смотрит на staging, вход через панель DEV (`POST /api/dev/login {role}`, только localhost), проход по изменённому пути в браузере и smoke в локальном режиме (§4). Поэтому staging-шагу не нужны ни PR, ни CI: CI — проверка перед merge и перед продом.

**Что поменялось против Раундов 1–4.** Раньше выкатывали ветку PR и сливали её после выкатки. Теперь `preflight` пускает на прод только коммит из `origin/main` (merge-коммит M), и только если его код совпадает с проверенным локально коммитом V (`--verified V`; отличаться могут лишь `docs/` и `*.md`). Поэтому сначала merge, потом выкатка. Railway к GitHub не подключён, и merge сам ничего не выкатывает. Если подключат (§14), merge станет выкаткой, и миграции нужно будет применять до merge.

**Миграции идут раньше кода.** Новый код должен работать и на старой схеме, и на новой (expand → contract). Тогда откат кода не требует отката схемы. Удалять колонку или таблицу, которую читает текущий код, можно только следующей выкаткой, после выкатки кода, который её уже не читает.

## 2. Перед выкаткой

1. «Да» PO на эту выкатку. Окно **не 03:00–06:00 UTC** (preflight откажет). Лучше не 21:45–23:00 UTC: в 22:00 идут ночные пересчёты Точек А и Б, деплой оборвёт идущие разборы.
2. Миграции волны применены к staging-базе, код проверен локально против staging (§4). Записать проверенный коммит V (голова ветки на момент проверки).
3. PR → зелёный CI → merge. **Дождаться CI по merge-коммиту** на `main` (событие push, около 5 минут — сколько идёт сборка): preflight проверяет именно его.
4. Чистая копия для выкатки. Не рабочая папка, где лежат чужие правки: `railway up` загружает **все** файлы папки, кроме исключённых `.gitignore`, в том числе неотслеживаемые.
   ```bash
   git worktree add --detach <deploy-dir> origin/main     # один раз
   git -C <deploy-dir> fetch origin && git -C <deploy-dir> checkout --detach origin/main
   ```
5. Railway CLI вошёл в аккаунт и привязан к проекту портала: `railway status` показывает `<project>` и нужное окружение. **`railway up` без привязки создаёт новый проект.** Флаги `-y` и `--new` не использовать никогда.
6. Preflight:
   ```bash
   cd <deploy-dir>
   node scripts/deploy/preflight.mjs --label <label> --verified <V> --since <коммит, который сейчас на проде> \
     [--staging-journal /tmp/staging-journal.txt]
   ```
   Коммит на проде берётся из отчёта прошлой выкатки или по §8. Журнал staging — как в §4 «Прод», шаг 1. Preflight проверяет:
   - установлены `git`, `gh`, `railway`;
   - `git fetch` прошёл;
   - дерево чистое, включая неотслеживаемые файлы;
   - `HEAD` = `origin/main` (или `--commit <sha>`, который есть в `origin/main`);
   - CI по коммиту зелёный через `gh`: обязательная проверка «typecheck · lint · tests …» — только `success` (пропущенная `skipped`/`neutral` — отказ: тесты не запускались). Проверка Vercel пропускается явно, строкой «игнорирую…»: аккаунт Vercel заблокирован, прод на Railway;
   - **код = проверенному**: `git diff --name-only <V> <коммит> -- . ':!docs' ':!*.md'` пуст. Если в `main` попало что-то ещё (слили другой PR) — отказ со списком файлов. Проверить локально этот коммит или, осознанно, `--allow-drift` (громкое предупреждение, причину — в отчёт выкатки);
   - время не 03:00–06:00 UTC;
   - новые миграции между `--since` и коммитом. Изменённая старая миграция — отказ: её сумма разойдётся с журналом. С `--staging-journal` каждая новая миграция должна быть в журнале staging с суммой своих байтов.

   Код выхода 0 — проверки пройдены, напечатан план с подставленными коммитом, именами и списком миграций. Код 1 — выкатка запрещена, плана нет.

## 3. Бэкап

Делается внутри сервиса `db-tools` по частной сети. Там есть клиент Postgres 17 и переменная `TGT_URL` — строка подключения к прод-базе (не печатать).

```bash
N=prod-before-<label>-<ГГГГММДДTЧЧММZ>
railway ssh -e production -s db-tools -- sh -c "pg_dump \"\$TGT_URL\" -Fc -Z6 -f /tmp/$N.dump && ls -l /tmp/$N.dump && sha256sum /tmp/$N.dump && pg_restore -l /tmp/$N.dump | grep -c ' TABLE '"
railway ssh -e production -s db-tools -- sh -c "base64 -w0 /tmp/$N.dump" | tr -d '\r\n' | base64 -D > ~/AI-Portal-backups/$N.dump
chmod 600 ~/AI-Portal-backups/$N.dump
shasum -a 256 ~/AI-Portal-backups/$N.dump                  # = сумма из db-tools
pg_restore -l ~/AI-Portal-backups/$N.dump | grep -c ' TABLE '   # = число из db-tools (pg_restore 17)
```

Сумма или число записей TABLE не совпали — стоп, бэкап повторить. Имя, размер и сумма идут в отчёт выкатки. Как восстанавливать — `docs/backup/README.md` §4.

Если вывод идёт в трубу, `railway ssh` не выделяет терминал. Поэтому `\r` в base64 не попадает, а `tr` — страховка.

## 4. Миграции: staging → прод

**Staging: база + локальная проверка.** Кода на staging не выкатывают. В рабочей копии ветки, миграции закоммичены:

1. Что применить:
   ```bash
   node scripts/deploy/preflight.mjs --env staging --label <label> --since <коммит на проде> [--staging-journal /tmp/staging-journal.txt]
   ```
   Без CI, без PR и даже без push: проверяется только то, что относится к staging-базе. Журнал staging — тот же запрос, что в «Прод», шаг 1, по новым файлам. Новые миграции между `--since` и HEAD. С журналом staging: какие уже применены с той же суммой (их в плане нет), какие ещё нет, и нет ли применённой **другой версии** файла — это отказ. Незакоммиченная миграция — отказ: на staging должны уйти байты коммита, на проде их сумма сверяется. Прочие незакоммиченные правки — предупреждение: проверенным считается коммит.
2. Миграции по порядку — `scripts/staging/apply-migration.sh`. Скрипт берёт адрес из файла `addr` рядом с файлом пароля (или `STAGING_PG_ADDR`), проверяет метку staging у базы и пишет `public.schema_migrations (file, checksum, applied_by)` в той же транзакции:
   ```bash
   STAGING_PG_PASSWORD_FILE=<файл пароля> scripts/staging/apply-migration.sh supabase/migrations/NNN_имя.sql
   ```
3. Локальная проверка кода этого коммита против staging:
   - `.env.local` смотрит на staging: `NEXT_PUBLIC_SUPABASE_URL` и ключи Supabase staging, `DATABASE_URL`/`DIRECT_URL` staging-базы, `ENABLE_DEV_AUTH_ROUTES=1` (docs/dev-login.md). Значения — вне репозитория;
   - `npm run dev -- -H 127.0.0.1`;
   - браузер `http://127.0.0.1:3000`, панель DEV → «Войти как роль» (`POST /api/dev/login {role}`), пройти изменённый путь каждой нужной ролью;
   - smoke в локальном режиме: `node scripts/smoke/post-deploy.mjs --base-url http://127.0.0.1:3000`. Редиректы без входа, 401/403 API, CSP без `*.supabase.co` и связь с базой staging — строго. Чего у dev-сервера быть не может (`deploymentId`, очередь Workflow, планировщик, Inngest, `CRON_SECRET`, локальный «Рынок» в CSP) — предупреждения.
4. Записать проверенный коммит V (`git rev-parse HEAD`) — он пойдёт в `--verified` на проде. Если после проверки в ветку что-то добавили — проверить заново.

**Прод.** На прод идут только те байты, что прошли staging. Порядок такой.

1. Журнал staging для этих файлов сохранить в файл. Нужен вывод `psql -At`, строки вида `файл|сумма`:
   ```bash
   PGPASSWORD="$(cat <файл пароля>)" psql "<staging-dsn>" -X -At \
     -c "SELECT file, checksum FROM public.schema_migrations WHERE file IN ('155_a.sql', '156_b.sql')" > /tmp/staging-journal.txt
   ```
2. Собрать пакет. Это делается локально, к базе скрипт не подключается:
   ```bash
   node scripts/deploy/migrations-bundle.mjs --label <label> --staging-journal /tmp/staging-journal.txt \
     supabase/migrations/155_a.sql supabase/migrations/156_b.sql
   ```
   Скрипт проверяет имена файлов и считает sha256 — ту же сумму, что пишут скрипты применения. Затем сверяет суммы с журналом staging. Если файла там нет или сумма другая, пакет не собирается: код 1, «сумма в staging другая». Ещё откажет файл, который нельзя применить одной транзакцией (свой `BEGIN;`/`COMMIT;`, `CREATE INDEX CONCURRENTLY`, `VACUUM`). Такие файлы применяются вручную, отдельно и с решением оркестратора.

   Результат лежит во временной папке:
   - `<label>-<время>.tar.gz` — файлы, `apply.sh` и `SHA256SUMS`. Собирается с `COPYFILE_DISABLE=1` в формате ustar.
   - `<label>-<время>.upload.sh` — команды передачи.
3. Передать пакет: `sh <…>.upload.sh`. Команды `railway ssh … db-tools` по частям переносят base64 в новую папку `/tmp/a360-mig-…` (`mkdir -m 700`; если такая папка уже есть — отказ). Затем проверяется сумма архива, архив распаковывается, выполняется `sha256sum -c SHA256SUMS`. Каждый файл должен дать `OK`. На этом шаге ничего не применяется.
4. Применить. Команду печатает `migrations-bundle`:
   ```bash
   railway ssh -e production -s db-tools -- sh -c 'sh /tmp/a360-mig-…/apply.sh'
   ```
   Для каждого файла по порядку выполняется:
   ```
   psql "$TGT_URL" -X -q -v ON_ERROR_STOP=1 -1 -f NNN_имя.sql -c "INSERT INTO public.schema_migrations (file, checksum, applied_by) … ON CONFLICT (file) DO UPDATE …"
   ```
   Миграция и её строка в журнале идут одной транзакцией. На первой ошибке скрипт останавливается. Предыдущие файлы остаются применёнными, каждый в своей транзакции. В конце печатается журнал по файлам пакета: суммы должны совпасть с выводом шага 2, `applied_by` = `<label>-db-tools`.

Внутри `sh -c` нет `rm -rf`: папка в `/tmp` контейнера исчезнет при его перезапуске.

Ещё до PR CI проверяет файлы миграций (`check-migrations.mjs`):
- номер новой миграции не повторяется. 15 старых повторов перечислены по полным именам файлов;
- у каждой миграции с номером от 140 есть `rollback/<имя>.down.sql`;
- в `rollback/` нет файлов без миграции.

## 5. Код

Из `<deploy-dir>`: дерево чистое, `HEAD` = коммит из плана preflight. Оба сервиса выкатываются из одного дерева:

```bash
railway up -e production -s portal --detach -m "<sha> <label>"
railway up -e production -s agents --detach -m "<sha> <label>"
railway deployment list -e production -s portal --limit 3 --json    # новая строка: status SUCCESS
railway deployment list -e production -s agents --limit 3 --json
```

- `-m` прикрепляет коммит к деплою (§8).
- Сборка и запуск занимают обычно 5–10 минут. Ждать SUCCESS у обоих. FAILED или CRASHED — логи сборки (`railway logs -e production -s portal --build`). Старый деплой при этом продолжает работать.
- У портала перед запуском выполняется pre-deploy `node scripts/railway/predeploy.mjs`: создаёт таблицы очереди Workflow и `cron_runs` в `workflow-db`. Если он упал, деплой не стартует.
- Railway пускает трафик на новый деплой после ответа `/api/healthz`, на это есть до 300 с. Старый работает ещё 45 с (overlap), потом получает SIGTERM и до 60 с дорабатывает фоновые задачи (draining).
- На каждом деплое CLI предупреждает, что `railway.json` читается только до 2026-12-01. Это известно, см. §13.

## 6. Inngest

Функции регистрируются в нашем Inngest (сервис `inngest`, только частная сеть). Это делается после каждой выкатки портала, даже если функции не менялись:

```bash
curl -fsS -X PUT https://portal.aistart360.app/api/inngest   # {"message":"Successfully registered","modified":true|false}
curl -fsS https://portal.aistart360.app/api/inngest          # function_count — сколько функций у портала
```

`modified:false` нормально: список не изменился. Если `function_count` не тот, что ожидали, значит выкачен не тот код или не та роль портала. Без регистрации сервер Inngest не узнает о новых функциях. Через 30 минут `/api/health` ответит 503 (`inngest: fail`), если пропал `ops-ping`.

## 7. Smoke

```bash
npm run smoke:prod -- --expect-deployment <deploymentId portal из §5> [--expect-functions <N>]
# локальная проверка (§4): node scripts/smoke/post-deploy.mjs --base-url http://127.0.0.1:3000
```

**Первая выкатка с R4-A4.** На проде до неё код без `deploymentId` в `/api/healthz`. Если smoke пишет «deploymentId нет — отвечает старый деплой», это **стоп, а не предупреждение**: новый деплой ещё не стал активным (сборка не SUCCESS, идёт overlap 45 с) или не поднялся. Дождаться SUCCESS у новой строки `railway deployment list`, подождать минуту и повторить smoke. `--revert` здесь не передавать.

Запросы только на чтение: GET без входа и без секретов, редиректы не выполняются. Итог выводится таблицей. Код выхода ≠ 0, если провалена хоть одна проверка:

| Путь | Ожидается |
|---|---|
| `/api/healthz` | 200 `ok`, `deploymentId` = только что выкаченный. Другой id — провал. **Поля нет — тоже провал**: у любой сборки начиная с R4-A4 на Railway оно есть, значит, отвечает старый деплой. Только при откате на код до R4-A4 (§9) smoke запускают с `--revert`, и тогда это предупреждение со сверкой по `railway deployment list` |
| `/api/health` | 200, все проверки `ok` (`unknown` — предупреждение: данных ещё нет, повторить через 15 мин) |
| `/`, `/login` | 200; у `/login` есть Content-Security-Policy с `connect-src`, без `localhost` и `*.supabase.co` |
| `/client/home`, `/point-a`, `/dashboard` без входа | редирект на `/login?from=<путь>` |
| `/admin-giga-panel`, `/super-expert` без входа | `/giga-login`, `/super-expert/login` |
| `/api/giga-admin/nav-badges` | 403 |
| `/api/v1/notifications?count=1`, `/api/expert/sla-tasks` | 401 |
| `/api/cron/ops-watchdog`, `/api/cron/agents` | 401 (503 — не задан `CRON_SECRET`) |
| `GET /api/inngest` | 200, `function_count` > 0 |

Вручную:

1. Логи без ошибок после старта: `railway logs -e production -s portal --lines 200`, то же для `agents`. Должна быть строка о запуске планировщика.
2. Через 15–20 минут — журнал исходов задач (ГИГА → Настройки → «Состояние системы» или запрос через `db-tools`):
   ```bash
   railway ssh -e production -s db-tools -- sh -c 'psql "$TGT_URL" -X -c "SELECT job, service, count(*) AS runs, count(*) FILTER (WHERE status <> '"'"'ok'"'"') AS bad, max(finished_at) AS last FROM public.ops_job_runs WHERE finished_at > now() - interval '"'"'30 minutes'"'"' GROUP BY 1, 2 ORDER BY bad DESC, job"'
   ```
   У всех задач `bad = 0`, есть строки и от `web`, и от `agents`.

Отчёт выкатки: коммит, `deploymentId` у portal и agents, имя и сумма бэкапа, миграции, итог smoke.

## 8. Что выкачено

`GET /api/healthz` отвечает так: `{"ok":true,"uptimeS":…,"deploymentId":"…","commit":…}`.

- `deploymentId` — `RAILWAY_DEPLOYMENT_ID`. Railway задаёт его при запуске любого деплоя.
- `commit` — `RAILWAY_GIT_COMMIT_SHA`. Railway задаёт его **только для деплоев из GitHub** (docs.railway.com → Variables → Railway-provided variables). При `railway up` переменной нет, и `commit` = `null`. Передать коммит в сборку надёжно нельзя. Файл в дереве сделал бы его грязным, а переменная сервиса — это правка настроек и лишний деплой.

Как сопоставить деплой с коммитом при `railway up`:

```bash
curl -fsS https://portal.aistart360.app/api/healthz                     # deploymentId
railway deployment list -e production -s portal --limit 20 --json       # id, status, createdAt, meta
```

- Найти строку с этим `id`. В ней `meta` с сообщением деплоя: `-m "<sha> <label>"` из §5. Поле внутри `meta` документацией CLI не описано, искать по тексту sha.
- Если сообщения нет (старые выкатки без `-m`), нужное время `createdAt` берётся из отчёта выкатки.
- В Railway → сервис → Deployments то же сообщение видно у деплоя.

## 9. Откат кода

Откатывать оба сервиса вместе: `portal` и `agents` собраны из одного коммита. После отката обязательно PUT `/api/inngest` (у старого кода может быть другой список функций) и smoke.

**Скрипты — из копии на `main`.** В старом коммите может не быть `scripts/deploy/*`, `scripts/smoke/*` и `npm run smoke:prod` (в коде до R4-A4, например `91b68374`, их нет). Поэтому preflight и smoke при откате всегда запускаются из второй копии `<tools-dir>` на свежем `main`, а `<deploy-dir>` только переключается на старый коммит:

```bash
git worktree add --detach <tools-dir> origin/main     # один раз; перед откатом: git -C <tools-dir> checkout --detach origin/main
```

**Smoke после отката.** `node <tools-dir>/scripts/smoke/post-deploy.mjs --expect-deployment <id из railway deployment list> --revert`. У кода до R4-A4 в `/api/healthz` нет `deploymentId`: с `--revert` smoke даст предупреждение «сверить по railway deployment list», а не провал (без `--revert` отсутствие поля — провал, §7). Деплой тогда сверяется по `railway deployment list -e production -s portal --json` (новая строка SUCCESS с сообщением `<sha> <label>-revert` или Rollback). Если `deploymentId` в ответе есть и он другой — это провал: отвечает не тот деплой.

**Путь А — Rollback в Railway.** Быстро, без сборки. Railway → сервис → Deployments → предыдущий SUCCESS (по сообщению `<sha> <label>`) → ⋯ → **Rollback**.
- По документации Railway (Deployments → Deployment actions) возвращаются образ **и переменные** того деплоя. Если переменные меняли после него, они откатятся тоже: после отката сверить список переменных с отчётом выкатки.
- Деплои старше срока хранения плана Railway откатить нельзя: кнопки у них нет.
- В CLI команды rollback нет. `railway redeploy` заново выкатывает **последний** деплой (ту же сборку), это не откат.
- Работает ли Rollback для деплоев, сделанных `railway up`, в документации не сказано. До сих пор возвращали именно так — redeploy предыдущей сборки (отчёт волны 2 Раунда 4).

**Путь Б — `railway up` с предыдущего коммита.** Медленнее (сборка 5–10 мин), но переменные остаются текущими, и срок хранения не важен:

```bash
git -C <deploy-dir> fetch origin && git -C <deploy-dir> checkout --detach <предыдущий sha>
node <tools-dir>/scripts/deploy/preflight.mjs --revert --commit <предыдущий sha> --dir <deploy-dir> --label <label>-revert
cd <deploy-dir>
railway up -e production -s portal --detach -m "<предыдущий sha> <label>-revert"
railway up -e production -s agents --detach -m "<предыдущий sha> <label>-revert"
node <tools-dir>/scripts/smoke/post-deploy.mjs --expect-deployment <id новой строки railway deployment list> --revert
```

`--revert` у preflight: проверенный коммит не нужен, миграции не трогаются, запрещённое окно 03:00–06:00 UTC — только предупреждение (инцидент не ждёт). Команда smoke в его плане уже с `--revert`. Остальное как обычно: чистое дерево `<deploy-dir>`, коммит из истории `origin/main`, зелёный CI по нему. План печатает команды с путями обеих копий.

Путь А — когда переменные не менялись и нужен быстрый откат. Путь Б — когда переменные менялись или деплой старый. Схему базы откат кода не трогает: миграции expand-only, старый код с новой схемой работает (§1). Если нет — сначала §10.

## 10. Откат миграций

- Файлы отката лежат в `supabase/migrations/rollback/NNN_имя.down.sql`. С 140 они есть у каждой миграции, это проверяет CI. До 140 откатов нет: только восстановление из бэкапа (`docs/backup/README.md` §4) или исправляющая миграция.
- Шапка файла отката говорит, что он открывает снова, что будет с кодом и в каком порядке откатывать: код первым или схему первой. Её нужно прочитать.
- Файлы отката идемпотентны и журнал `schema_migrations` сами не трогают. Журнал ведёт тот, кто откатывает. Правило: откатили — строку миграции **удалить**, в той же транзакции. Журнал = что применено сейчас. Старые шапки 140 и 143 советуют `apply-migration.js`, и тот записывает в журнал имя `.down.sql`. Так больше не делаем.
- Порядок обратный применению: сначала самая новая. Бэкап перед откатом (§3).

На прод — тем же пакетом, с `--rollback`:

```bash
node scripts/deploy/migrations-bundle.mjs --rollback --label <label>-undo \
  supabase/migrations/rollback/156_b.down.sql supabase/migrations/rollback/155_a.down.sql
sh <…>.upload.sh
railway ssh -e production -s db-tools -- sh -c 'sh /tmp/a360-mig-…/apply.sh'
```

Для каждого файла выполняется `psql -1 -f NNN_имя.down.sql -c "DELETE FROM public.schema_migrations WHERE file = 'NNN_имя.sql'"`, в порядке убывания номеров. В конце журнал по этим миграциям должен быть пуст.

На staging — вручную, тем же способом:

```bash
PGPASSWORD="$(cat <файл пароля>)" psql "<staging-dsn>" -X -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/rollback/NNN_имя.down.sql -c "DELETE FROM public.schema_migrations WHERE file = 'NNN_имя.sql'"
```

Повторное применение после отката — обычная выкатка миграции (§4). У каждого отката есть тест «миграция → откат → снова миграция» на тестовой базе. Для 141 и 142 это `tests/integration/db/rollback-141-142.test.ts`.

## 11. Inngest упал

**Как заметить:**
- `/api/health` отвечает 503 с `inngest: fail`: нет `ops-ping` дольше 30 минут;
- сторож присылает «задача `inngest:*` давно не запускалась»;
- ГИГА → «Состояние системы» показывает то же;
- сервис `inngest` в Railway: статус и логи. Он зависит от Redis и базы `inngest` на прод-Postgres.

**Что продолжает работать без Inngest:**
- все кроны планировщика портала и сервиса агентов (`lib/cron/schedule.ts`): SLA экспертов, сторожа, дайджесты, `billing-expiry`, `backup-freshness`, заявки на оплату, обслуживание очереди агентов;
- очередь пересчёта Точки А в базе: агенты разбирают её каждую минуту;
- кнопка пересчёта Точки Б в ГИГА: считает сразу, без Inngest.

`inngest.send` падает не дольше чем за ≈15 с (R4-A2). Вебхук мессенджера отвечает 500, провайдер повторяет доставку. Сообщения ждут, дублей нет.

**Что стоит:**
- правило 30 минут в «Сообщениях» (`comm-escalations`);
- автоответ бота (`comm-bot-reply`): если событие не ушло, персонал получает уведомление;
- обработка входящих омниканала (`process-omnichannel-message`) и обслуживание омниканала;
- ночная волна Точки А (22:00 UTC, только постановка в очередь);
- пересчёт Точки Б по расписанию;
- месячная сверка Б (1-го числа);
- внешние приглашения Б;
- рассылки и их сторож;
- чистка демо-аккаунтов.

**Что делать:**

1. Поднять `inngest`: логи, затем `railway restart -e production -s inngest`. Если не помогло — Redis и база `inngest`. После подъёма — PUT `/api/inngest` (§6). Через ≤10 минут `/api/health` покажет `inngest: ok`.
2. Если сбой надолго — перевести омниканал на очередь в базе. У сервиса `portal` в Railway задать переменную `OMNICHANNEL_PROCESSING_BACKEND=database`. Это вызовет деплой с той же сборкой. Вебхук пишет задание в Postgres и разбирает его в том же процессе сразу после ответа. Задания, которые не успел разобрать процесс, разбираются со следующим входящим и кикером моста WhatsApp.
   - Перед сменой отметить, была ли переменная задана и с каким значением (это не секрет, но значение берётся у PO или из панели).
   - Когда Inngest поднимется, вернуть как было.
3. Догнать пропущенное. Пропущенные запуски по расписанию Inngest не повторяет. Задачи, которые смотрят на состояние, догоняют сами на следующем запуске: `comm-escalations` (каждые 5 мин), обслуживание омниканала, внешние приглашения Б (каждые 15 мин), сторож рассылок (оживляет зависшие, каждые 15 мин), чистка демо-аккаунтов (раз в сутки). Остальное:
   - **Ночная волна Точки А** — следующей ночью. Срочно для клиента — пересчёт из ГИГА.
   - **Пересчёт Точки Б** — событие `point-b/recompute.continue` без данных: полный проход с начала, мимо расписания.
   - **Месячная сверка Б** — событие `point-b/monthly.continue` с `{"period":"ГГГГ-ММ"}` (прошедший месяц). Без `period` берётся прошедший месяц от текущей даты.

   Событие отправляется изнутри сервиса `portal`. Ключ события остаётся в контейнере:
   ```bash
   railway ssh -e production -s portal -- node -e 'fetch(process.env.INNGEST_SELF_HOSTED_URL+"/e/"+process.env.INNGEST_SELF_EVENT_KEY,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"point-b/monthly.continue",data:{period:"2026-10"}})}).then(r=>console.log(r.status))'
   ```
   Рассылки, запущенные во время сбоя, проверить в ГИГА → «Рассылки».

## 12. workflow-db упала

`workflow-db` — отдельный Postgres для очереди Workflow и захвата минут планировщика (`cron_runs`). Ссылка на него — `WORKFLOW_POSTGRES_URL` у `portal` и `agents`.

**Что происходит:**
- Ни одна задача по расписанию не запускается ни в портале, ни в агентах, в том числе сторожа. Без захвата минуты планировщик задачу пропускает, а не запускает дважды.
- Через 5 минут неудач планировщик пишет `console.error` и шлёт тревогу в Telegram без базы, если задан `TELEGRAM_ADMIN_CHAT_IDS` (docs/ops/README.md §1).
- `/api/health` отвечает 503 (`queue: fail`). `/api/healthz` остаётся 200, поэтому Railway портал не перезапускает. Так и задумано.
- При `OMNICHANNEL_PROCESSING_BACKEND=workflow` входящие не обрабатываются.
- **Новый деплой портала упадёт на pre-deploy**: ему нужна `workflow-db`. Не выкатывать, пока она не поднимется. Старый деплой продолжает работать.

**Что делать:**

1. Railway → `workflow-db`: статус, логи, место на томе. Затем `railway restart -e production -s workflow-db`.
2. После подъёма:
   - Захват минут и очередь Workflow восстанавливаются сами: очередь переподключается с паузами, перезапуск портала не нужен. `/api/health` → `queue: ok`.
   - Если база поднялась **пустой** (пересоздана), нужен `railway redeploy -e production -s portal`: pre-deploy создаст таблицы очереди и `cron_runs`.
3. Пропущенные минуты не повторяются. Суточные задачи, чьё время попало в сбой, запустить вручную, **только те, что действительно не прошли** (последний запуск — в `ops_job_runs`). Расписание — `lib/cron/schedule.ts`: `billing-expiry` 00:15, `ai-discovery` 01:30, `staff-digest` 03:00, `crm-digest` и `agents-digest` 04:00, `client-digest` по понедельникам 04:00, `telegram/personal/sync` 05:00, `reminders` 06:00, `analytics-rollup` 21:30 UTC. Запуск изнутри сервиса, секрет из контейнера не выходит. Для `agents-digest` — `-s agents`:
   ```bash
   railway ssh -e production -s portal -- node -e 'fetch("http://localhost:"+(process.env.PORT||3000)+"/api/cron/staff-digest",{headers:{authorization:"Bearer "+process.env.CRON_SECRET}}).then(r=>console.log(r.status))'
   ```
   Повторный запуск дайджеста отправит его второй раз. Поэтому только пропущенные.

## 13. 2026-12-01: Railway перестаёт читать `railway.json`

**Факты.** Настройки сервисов прочитаны 2026-11-16, только чтение.

- `railway.json` в корне задаёт:
  - сборку: Railpack, `npm run build`;
  - запуск: `node node_modules/next/dist/bin/next start -H 0.0.0.0`;
  - pre-deploy: `node scripts/railway/predeploy.mjs`;
  - healthcheck: `/api/healthz`, 300 с;
  - перезапуск: `ON_FAILURE`;
  - overlap 45 с, draining 60 с;
  - europe-west4, 1 реплика.

  С 2026-12-01 Railway Config as Code не читает. CLI предупреждает об этом при каждом деплое.
- **`portal`** в настройках сервиса: всё то же. Политика перезапуска там не показана. Значит, после 01.12 действует умолчание Railway «On Failure, до 10 перезапусков» (docs.railway.com → Restart policy) — по сути то же. **Для портала ничего не меняется.**
- **`agents`** в настройках сервиса: те же сборка, запуск, healthcheck 300 с и draining 60 с. Но **overlap 0** и **нет pre-deploy**. Pre-deploy при `PORTAL_ROLE=agents` и так ничего не делает. Сейчас `railway up` из папки, вероятно, применяет `railway.json`, и у agents overlap 45. После 01.12 станет 0.

**Что будет у agents.**
- **Сейчас (45 с).** После того как новый деплой agents прошёл healthcheck, до 45 с работают два процесса и два планировщика.
  - Дважды задача не запускается: минуту каждой задачи захватывает один процесс в `cron_runs` (`workflow-db`).
  - Задачи агентов берутся через `FOR UPDATE SKIP LOCKED`.
  - Издержки: двойные холостые запросы к базе на эти секунды. Задачу может взять старый процесс и через несколько секунд получить SIGTERM: draining 60 с даёт ему до 55 с, чтобы закончить (`lib/runtime/server-start.ts`). Если `workflow-db` недоступна, захват не проходит, и задача не запускается ни в одном процессе.
- **После 01.12 (0 с).** Старый процесс получает SIGTERM сразу, как новый прошёл healthcheck. Планировщик нового к этому моменту уже запущен: он стартует вместе с сервером, до проверки. Окна с двумя планировщиками нет, пропуска минут не ожидается. Draining 60 с задан в самом сервисе и остаётся.
  - Публичного трафика у agents нет. Overlap защищал бы только «пинок» портала → агентам по частной сети, а он best effort: минутный крон агентов подбирает задачу не позже чем через минуту.

**Рекомендация:** overlap 0 у agents приемлем и даже проще. Главное — draining 60 с, а он в сервисе есть. Срочно менять ничего не нужно. Нужно до 01.12:

1. Оркестратор, только чтение: `railway config migrate` **без** `--apply` в production (в staging у `portal` и `agents` деплоев нет — там смотреть нечего, кроме сервисов Supabase). Это превью: какие сервисы ещё на Config as Code и что Railway перенёс бы. Сверить с фактами выше.
2. Если превью или настройки сервиса покажут, что у `portal` или `agents` чего-то нет (запуск с `-H 0.0.0.0`, healthcheck, draining 60), задать это в настройках сервиса до 01.12. Это правка настроек прода, только с «да» PO. Можно и переменными `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` / `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`.
3. **Решение PO:** overlap у agents — оставить 0 (рекомендация) или поставить 45, как у портала (тогда так же, как сейчас).
4. Первая выкатка после 01.12 — штатно, по этому runbook. Смотреть: предупреждения про Config as Code в выводе CLI больше нет, healthcheck и остановка старого деплоя прошли, в логах agents нет обрыва задач.
5. `railway.json` пока не удалять. Он справка и закреплён тестом `tests/unit/infra/railway-config.test.ts`. Переход на `.railway/railway.ts` — [railway-config.md](railway-config.md).

## 14. PR, CI и выкатка из GitHub

- CI — `.github/workflows/ci.yml`, три параллельных job и итоговый (с 2026-11-17; до того один последовательный job, около 10,5 минуты):
  - «tsc · lint · migration numbers» — номера и откаты миграций, `tsc`, lint;
  - «tests (prod-mirror DB, real RLS)» — тестовая база из миграций, vitest. Тесты, меняющие схему (повтор миграции, её отката, ALTER/DROP/CREATE), идут отдельным проектом vitest после остальных, по одному файлу (`vitest.config.ts`): параллельно они попадали в deadlock с другими тестами;
  - «production build (next build)» — сборка, как на Railway;
  - «typecheck · lint · tests (with prod-mirror DB)» — итоговый: зелёный, только если зелёные все три. Именно его требует preflight (`CI_CHECK_PREFIX`), поэтому имя прежнее.
- `node_modules` берётся из кэша по `package-lock.json`, точной версии Node и схеме Prisma (`.github/actions/install`); при промахе — `npm ci`, кэш пишет только job статических проверок. Время прогона — время самого долгого job, сборки (около 5 минут).
- Проверка Vercel у PR всегда красная: аккаунт Vercel заблокирован, прод на Railway. Её игнорируют глазами и в preflight (с явной строкой).
- Порядок: ветка → миграции на staging-базу и локальная проверка (§4) → PR → зелёный CI → merge → CI по merge-коммиту → выкатка по §2–§7 с `--verified`. PR можно открыть и раньше локальной проверки — preflight staging от него не зависит.

**Чтобы выкатка шла из GitHub после зелёного CI** (аудит §3.4, решение PO):

1. GitHub: защитить `main`. Только через PR, обязательная проверка CI-job, запрет force-push.
2. Railway: подключить репозиторий к `portal` и `agents` (ветка `main`) и включить **Wait for CI**. Деплой ждёт в статусе WAITING, пока не закончатся все check suites GitHub Actions по коммиту. Упавший CI пропускает деплой. Проверки других приложений GitHub, в том числе Vercel, не учитываются.
3. Тогда `/api/healthz` начнёт отдавать `commit` (`RAILWAY_GIT_COMMIT_SHA`).
4. Миграции остаются ручными (§4) и идут **до** merge. Либо PR с миграцией сливается только после её применения на проде.
5. После автодеплоя — §6 и §7. Откат — §9 (путь А). Путь Б — revert-коммит в `main`.

## 15. Закрыть регистрацию в GoTrue (`GOTRUE_DISABLE_SIGNUP=true`)

**Только по отдельному «да» PO.** Это правка настроек прода, в обычную выкатку она не входит. Источник фактов — отчёт исполнителя B3 (Раунд 4, волна 3), §2.

**Зачем — состояние после исправлений B3 (коммит `358ddee7`).** В режиме регистрации `invite` портал сам аккаунтов не создаёт, но GoTrue открыт напрямую: `POST /auth/v1/signup` с anon-ключом (он есть в браузерном бандле) и вход через Google нового человека по-прежнему **создают** пользователя GoTrue и профиль «на одобрении».

- **Через страницы портала такой аккаунт уже не проходит.** Метку `app_metadata.signup_blocked` ставят колбэк, `/auth/verify` и правило middleware для страниц: ожидающий без метки, не приглашённый, созданный после включения `invite`, получает метку при первой же странице. Помеченный и не одобренный уходит на «Регистрация по приглашению», сессия гасится. Вход паролем (`/api/auth/password`) и `/api/client/register` помеченному отказывают. API с меткой в JWT middleware закрывает.
- **Остаётся путь «только API».** Свежий **непомеченный** аккаунт (signup по anon-ключу или Google в implicit-режиме), который ни разу не открывал страницу портала, проходит middleware: метки в JWT нет, а профиль для API middleware не читает. Такой аккаунт может скриптом звать API клиента — ИИ-чат (свой дневной бюджет на каждый аккаунт, аккаунтов сколько угодно), «Сообщения» персоналу, документы. Этот путь закрывает именно `GOTRUE_DISABLE_SIGNUP=true`: GoTrue перестаёт создавать пользователей сам.
- Уже созданные «сироты» остаются (см. конец раздела).

**Где.** Переменная `GOTRUE_DISABLE_SIGNUP` сервиса GoTrue нашего Supabase на Railway (в панели проекта — сервис GoTrue, в старых документах его называют `auth`). GoTrue читает настройки из окружения с префиксом `GOTRUE_`; конфигурации GoTrue в репозитории нет (R-050 в `docs/audit-2026-11/R3-AUDIT-C.md`). Имя сверить в панели: если переменная уже есть (шаблон мог задать `false`), поменять значение, вторую не заводить. Смена переменной перезапускает GoTrue: несколько секунд вход и обновление сессий не работают. Делать в тихое время: не 03:00–06:00 и не 21:45–23:00 UTC.

**Что перестаёт работать:**
- `POST /auth/v1/signup` по anon-ключу — отказ GoTrue `signup_disabled`;
- новый человек через Google (и любой OAuth) — GoTrue пользователя не создаёт.
  - **Не проверено, проверить на staging до прода:** как именно GoTrue сообщает об отказе. Если `error_code=signup_disabled` приходит в query колбэка, портал покажет «Регистрация по приглашению» (`isSignupDisabledError`, `lib/auth/invite-only-shared.ts`; `app/auth/callback/route.ts`). Если ошибка приходит во фрагменте `#…` (implicit-режим), сервер её не видит, и человек попадёт на `/login` без пояснения.
  - На безопасность это не влияет — пользователь не создан, но текст экрана зависит от этого.

**Что должно продолжать работать.** Портал создаёт аккаунты только служебным API (`service_role`), публичный signup не вызывает (`auth.signUp` / `signInWithOtp` в коде нет — сверено по коду). **Не проверено, проверить на staging до прода:** что служебные методы GoTrue флаг `disable_signup` не учитывают. Это по памяти исполнителя B3 об исходниках GoTrue. Если окажется иначе, перестанут работать приглашения и регистрация через портал — тогда на прод не включать:
- приглашения ГИГА — `admin.generateLink` invite (`lib/admin/invites.ts`);
- регистрация в режимах `approval` / `open` и демо-доступ — `admin.createUser`;
- вход по ссылке на почту — `generateLink` magiclink, только для существующих;
- вход владельца ГИГА и «вход от имени» — `generateLink` magiclink для существующих;
- вход через Google существующего аккаунта и привязка Google к аккаунту с паролем по той же почте — это не signup и должно работать, но **тоже не проверено** (проверить на staging).

**Порядок:**

1. «Да» PO.
2. **Staging.** У сервиса GoTrue окружения `staging` задать `GOTRUE_DISABLE_SIGNUP=true`. Проверить локальным порталом против staging (§4):
   - отказ публичного signup:
     ```bash
     curl -sS -X POST "<Supabase URL staging>/auth/v1/signup" -H "apikey: <anon-ключ staging>" \
       -H 'content-type: application/json' -d '{"email":"probe@staging.aistart360.test","password":"<случайный>"}'
     # ждём ошибку signup_disabled; ключ и URL — из .env.local, в отчёт не копировать
     ```
   - вход Google **существующим** аккаунтом. Нужен Google-провайдер у GoTrue staging и аккаунт staging с этой почтой. Если провайдер на staging не настроен — пункт проверяется на проде сразу после включения, с готовым откатом (шаг 4);
   - новый Google-аккаунт: пользователь GoTrue **не создан** (главное — проверить в базе staging: `SELECT count(*) FROM auth.users WHERE email = '<почта>'` = 0). Куда попал человек — «Регистрация по приглашению» или `/login` — записать (это и есть непроверенный пункт про query/фрагмент). Без Google-провайдера на staging — этот пункт тоже на проде сразу после включения, с готовым откатом;
   - одно приглашение до конца: ГИГА → «Пригласить» на свою тестовую почту → ссылка → пароль → вход. Письмо с локального сервера уходит, только если в `.env.local` есть ключ Resend;
   - «Войти по ссылке на почту» существующим аккаунтом;
   - регистрация в режиме `approval`: ГИГА → Настройки → режим регистрации `approval` → `/register` → аккаунт «на одобрении» создаётся. После проверки вернуть режим staging как был.
   - Хоть один пункт «должно работать» не прошёл — на прод не включать, вернуть staging (шаг 4) и разобраться.
3. **Прод.** То же у сервиса GoTrue окружения `production`. Сразу после: `curl` signup → `signup_disabled`; вход Google существующим аккаунтом; вход по ссылке. Время включения — в отчёт.
4. **Откат.** Вернуть `GOTRUE_DISABLE_SIGNUP` как было до включения (`false` или удалить переменную, если её не было). GoTrue перезапустится, публичный signup снова открыт. Данные не меняются.

Сироты, созданные до включения (Google в режиме `invite`), остаются: профиль «на одобрении» и метка `signup_blocked`. Их разбор — отдельное решение PO.

## 16. Клиентский Telegram-бот: секрет вебхука (R-139, Раунд 5)

**Что поменялось.** `/api/telegram/webhook` (бот `TELEGRAM_BOT_TOKEN`) работает как боты персонала: без `TELEGRAM_WEBHOOK_SECRET` отвечает **503** и ничего не обрабатывает; заголовок `X-Telegram-Bot-Api-Secret-Token` сверяется за постоянное время (401). Код привязки `/start <код>` живёт 15 минут (`profiles.telegram_link_code_expires_at`, миграция 158) и срабатывает один раз. Миграция 158 — **до** кода (§1): новый код пишет эту колонку.

**Состояние на 2026-11-19:** на проде секрет не задан, клиентов с привязанным Telegram — 0. После выкатки бот отвечает Telegram 503, пока не сделаны шаги ниже; Telegram копит апдейты и повторяет их до суток.

**Шаги (значения не печатать и не копировать в отчёт):**

1. Сгенерировать секрет — 32+ символа `A-Z a-z 0-9 _ -`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — и сразу вставить в переменную `TELEGRAM_WEBHOOK_SECRET` сервиса `portal` (production). Сервис перезапустится.
2. Перерегистрировать вебхук с этим секретом из окружения, где есть `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` (например, `railway run -s portal -- …` в `<deploy-dir>`):
   ```bash
   npx tsx scripts/telegram/set-webhooks.ts https://<прод-домен> --bots client --dry-run   # план
   npx tsx scripts/telegram/set-webhooks.ts https://<прод-домен> --bots client             # setWebhook с secret_token + setMyCommands
   npx tsx scripts/telegram/set-webhooks.ts https://<прод-домен> --bots client --info      # url, pending, last_error
   ```
   Скрипт токены и секреты не печатает; без секрета вебхук не регистрирует.
3. Проверить: `--info` — `url` = `https://<прод-домен>/api/telegram/webhook`, без `last_error`; POST без заголовка на `/api/telegram/webhook` → 401 (не 503); кабинет → «Настройки → Уведомления» → «Привязать Telegram» → «Start» в боте в течение 15 минут → «Готово».

Порядок важен: сначала секрет в сервисе (шаг 1), потом `setWebhook` (шаг 2). Между шагами Telegram получает 401 и повторит апдейты сам.

**Откат.** Откат кода (§9) возвращает прежнее поведение: без секрета бот снова принимает апдейты без проверки. Секрет в сервисе можно оставить — прежний код его тоже проверяет.
