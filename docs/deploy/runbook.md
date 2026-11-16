# Выкатка портала: runbook

Как выкатывать портал AIStart360 на Railway, как проверять и откатывать. Раунд 4, пакет R4-A4: закрывает R-019, N4A-6 и документ по R-020 аудита `docs/audit-2026-11/R4-AUDIT-A.md`. Описан порядок, по которому выкатывали Раунды 1–4, и скрипты, которые его проверяют.

| Что | Где |
|---|---|
| Проверки перед выкаткой и план команд | `scripts/deploy/preflight.mjs` (`npm run deploy:preflight -- …`) |
| Пакет миграций для `db-tools` | `scripts/deploy/migrations-bundle.mjs` |
| Smoke после выкатки, только чтение | `scripts/smoke/post-deploy.mjs` (`npm run smoke:prod`) |
| Номера и откаты миграций в CI | `scripts/deploy/check-migrations.mjs`, шаг в `.github/workflows/ci.yml` |
| Что выкачено | `GET /api/healthz` → `deploymentId`, `commit` |
| Откаты миграций | `supabase/migrations/rollback/NNN_*.down.sql` (с 140 — у каждой миграции) |
| Настройки сервисов Railway, `railway.json` | [railway-config.md](railway-config.md), §13 ниже |
| Тревоги и сторожа | [docs/ops/README.md](../ops/README.md) |
| Бэкапы и восстановление | [docs/backup/README.md](../backup/README.md) |
| Staging | [docs/staging/README.md](../staging/README.md) |

Скрипты ничего не выкатывают сами. `preflight` проверяет и печатает команды. `migrations-bundle` собирает пакет и печатает команды. `smoke` только читает. Каждую команду из плана человек запускает сам, по одной, и смотрит на вывод.

Обозначения: `<project>` — проект портала в Railway (выбирается `railway link`), `<deploy-dir>` — отдельная чистая копия репозитория для выкатки, `<label>` — имя выкатки (`round4w3`). Сервисы называются по именам: `portal`, `agents`, `db-tools`, `inngest`, `workflow-db`. Значения переменных Railway не смотреть и не печатать, только имена.

## 1. Порядок

```
«да» PO ─► staging (миграции → код → smoke) ─► PR ─► зелёный CI ─► merge в main
        ─► preflight (prod) ─► бэкап ─► миграции прод ─► код portal + agents ─► PUT /api/inngest
        ─► smoke ─► через 15–20 мин журнал ops_job_runs ─► отчёт выкатки
```

**Что поменялось против Раундов 1–4.** Раньше выкатывали ветку PR и сливали её после выкатки. Теперь `preflight` пускает на прод только коммит из `origin/main`. Поэтому сначала merge, потом выкатка. Railway к GitHub не подключён, и merge сам ничего не выкатывает. Если подключат (§14), merge станет выкаткой, и миграции нужно будет применять до merge.

**Миграции идут раньше кода.** Новый код должен работать и на старой схеме, и на новой (expand → contract). Тогда откат кода не требует отката схемы. Удалять колонку или таблицу, которую читает текущий код, можно только следующей выкаткой, после выкатки кода, который её уже не читает.

## 2. Перед выкаткой

1. «Да» PO на эту выкатку. Окно **не 03:00–06:00 UTC** (preflight откажет). Лучше не 21:45–23:00 UTC: в 22:00 идут ночные пересчёты Точек А и Б, деплой оборвёт идущие разборы.
2. Тот же коммит уже прошёл staging: миграции, код, smoke (§4–§7 с `-e staging`).
3. Чистая копия для выкатки. Не рабочая папка, где лежат чужие правки: `railway up` загружает **все** файлы папки, кроме исключённых `.gitignore`, в том числе неотслеживаемые.
   ```bash
   git worktree add --detach <deploy-dir> origin/main     # один раз
   git -C <deploy-dir> fetch origin && git -C <deploy-dir> checkout --detach origin/main
   ```
4. Railway CLI вошёл в аккаунт и привязан к проекту портала: `railway status` показывает `<project>` и нужное окружение. **`railway up` без привязки создаёт новый проект.** Флаги `-y` и `--new` не использовать никогда.
5. Preflight:
   ```bash
   cd <deploy-dir>
   node scripts/deploy/preflight.mjs --label <label> --since <коммит, который сейчас на проде>
   ```
   Коммит на проде берётся из отчёта прошлой выкатки или по §8. Preflight проверяет:
   - установлены `git`, `gh`, `railway`;
   - `git fetch` прошёл;
   - дерево чистое, включая неотслеживаемые файлы;
   - `HEAD` = `origin/main` (или `--commit <sha>`, который есть в `origin/main`);
   - CI по коммиту зелёный через `gh`. Проверка Vercel пропускается явно, строкой «игнорирую…»: аккаунт Vercel заблокирован, прод на Railway;
   - время не 03:00–06:00 UTC;
   - новые миграции между `--since` и коммитом. Изменённая старая миграция — отказ: её сумма разойдётся с журналом.

   Код выхода 0 — проверки пройдены, напечатан план с подставленными коммитом, именами и списком миграций. Код 1 — выкатка запрещена, плана нет. Для staging: `--env staging --base-url https://<staging-url>`. Коммит должен быть запушен, окно не ограничено.

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

**Staging.** Каждый файл по порядку применяется скриптом `scripts/staging/apply-migration.sh`. Скрипт проверяет метку staging у базы и пишет `public.schema_migrations (file, checksum, applied_by)` в той же транзакции:

```bash
STAGING_PG_PASSWORD_FILE=<файл пароля> scripts/staging/apply-migration.sh supabase/migrations/NNN_имя.sql
```

Потом идут код и smoke на staging (§5–§7 с `-e staging`).

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
# staging: node scripts/smoke/post-deploy.mjs --base-url https://<staging-url>
```

Запросы только на чтение: GET без входа и без секретов, редиректы не выполняются. Итог выводится таблицей. Код выхода ≠ 0, если провалена хоть одна проверка:

| Путь | Ожидается |
|---|---|
| `/api/healthz` | 200 `ok`, `deploymentId` = только что выкаченный |
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

Откатывать оба сервиса вместе: `portal` и `agents` собраны из одного коммита. После отката обязательно PUT `/api/inngest` (у старого кода может быть другой список функций) и smoke с `--expect-deployment`.

**Путь А — Rollback в Railway.** Быстро, без сборки. Railway → сервис → Deployments → предыдущий SUCCESS (по сообщению `<sha> <label>`) → ⋯ → **Rollback**.
- По документации Railway (Deployments → Deployment actions) возвращаются образ **и переменные** того деплоя. Если переменные меняли после него, они откатятся тоже: после отката сверить список переменных с отчётом выкатки.
- Деплои старше срока хранения плана Railway откатить нельзя: кнопки у них нет.
- В CLI команды rollback нет. `railway redeploy` заново выкатывает **последний** деплой (ту же сборку), это не откат.
- Работает ли Rollback для деплоев, сделанных `railway up`, в документации не сказано. До сих пор возвращали именно так — redeploy предыдущей сборки (отчёт волны 2 Раунда 4).

**Путь Б — `railway up` с предыдущего коммита.** Медленнее (сборка 5–10 мин), но переменные остаются текущими, и срок хранения не важен:

```bash
git -C <deploy-dir> checkout --detach <предыдущий sha>
cd <deploy-dir> && node scripts/deploy/preflight.mjs --label <label>-revert --commit <предыдущий sha>
railway up -e production -s portal --detach -m "<предыдущий sha> <label>-revert"
railway up -e production -s agents --detach -m "<предыдущий sha> <label>-revert"
```

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
3. Пропущенные минуты не повторяются. Суточные задачи, чьё время попало в сбой, запустить вручную, **только те, что действительно не прошли** (последний запуск — в `ops_job_runs`). Расписание — `lib/cron/schedule.ts`: `billing-expiry` 00:15, `ai-discovery` 01:30, `staff-digest` 03:00, `crm-digest` и `agents-digest` 04:00, `telegram/personal/sync` 05:00, `reminders` 06:00, `analytics-rollup` 21:30 UTC. Запуск изнутри сервиса, секрет из контейнера не выходит. Для `agents-digest` — `-s agents`:
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

1. Оркестратор, только чтение: `railway config migrate` **без** `--apply` в staging и в production. Это превью: какие сервисы ещё на Config as Code и что Railway перенёс бы. Сверить с фактами выше.
2. Если превью или настройки сервиса покажут, что у `portal` или `agents` чего-то нет (запуск с `-H 0.0.0.0`, healthcheck, draining 60), задать это в настройках сервиса до 01.12. Это правка настроек прода, только с «да» PO. Можно и переменными `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` / `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`.
3. **Решение PO:** overlap у agents — оставить 0 (рекомендация) или поставить 45, как у портала (тогда так же, как сейчас).
4. Первая выкатка после 01.12 — штатно, по этому runbook. Смотреть: предупреждения про Config as Code в выводе CLI больше нет, healthcheck и остановка старого деплоя прошли, в логах agents нет обрыва задач.
5. `railway.json` пока не удалять. Он справка и закреплён тестом `tests/unit/infra/railway-config.test.ts`. Переход на `.railway/railway.ts` — [railway-config.md](railway-config.md).

## 14. PR, CI и выкатка из GitHub

- CI — один job «typecheck · lint · tests (with prod-mirror DB)» в `.github/workflows/ci.yml`. Шаги: номера и откаты миграций, `tsc`, lint, тестовая база из миграций, vitest, `next build`.
- Проверка Vercel у PR всегда красная: аккаунт Vercel заблокирован, прод на Railway. Её игнорируют глазами и в preflight (с явной строкой).
- Порядок: ветка → staging → PR → зелёный CI → merge → выкатка по §2–§7.

**Чтобы выкатка шла из GitHub после зелёного CI** (аудит §3.4, решение PO):

1. GitHub: защитить `main`. Только через PR, обязательная проверка CI-job, запрет force-push.
2. Railway: подключить репозиторий к `portal` и `agents` (ветка `main`) и включить **Wait for CI**. Деплой ждёт в статусе WAITING, пока не закончатся все check suites GitHub Actions по коммиту. Упавший CI пропускает деплой. Проверки других приложений GitHub, в том числе Vercel, не учитываются.
3. Тогда `/api/healthz` начнёт отдавать `commit` (`RAILWAY_GIT_COMMIT_SHA`).
4. Миграции остаются ручными (§4) и идут **до** merge. Либо PR с миграцией сливается только после её применения на проде.
5. После автодеплоя — §6 и §7. Откат — §9 (путь А). Путь Б — revert-коммит в `main`.
