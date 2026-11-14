# Бэкапы портала AIStart360

Здесь описаны бэкап базы, копия файлов Storage, сторож свежести, резервный сервер и восстановление. Закрывает R-011: раньше скрипт бэкапа жил только в переменной Railway `BACKUP_SCRIPT`.

| Что | Где |
|---|---|
| Скрипт бэкапа (Railway, cron-сервис `db-backup`) | `scripts/backup/railway-db-backup.sh` |
| Учение и ручное восстановление | `scripts/backup/restore-drill.sh` |
| Резервный сервер (VPS в Казахстане) | `scripts/backup/vps/` — см. [README](../../scripts/backup/vps/README.md) |
| Журнал запусков | таблица `public.ops_backup_runs`, миграция `supabase/migrations/142_ops_backup_runs.sql` |
| Сторож свежести | `lib/ops/backup-freshness.ts`, `GET /api/cron/backup-freshness` раз в час, в :07 UTC (`lib/cron/schedule.ts`) |
| Тесты | `tests/unit/ops/backup-freshness.test.ts`, `tests/integration/db/backup.test.ts` (там скрипт работает с поддельными `rclone`/`rsync` из `tests/fixtures/backup/`) |

## 1. Как это работает

```
Railway cron db-backup (postgres:17, 30 0,8,16 * * * UTC = 05:30 / 13:30 / 21:30 Алматы)
 │
 ├─ db       снимок REPEATABLE READ → счётчики строк ключевых таблиц + pg_dump --snapshot (-Fc)
 │           проверки: размер > 1 МБ, таблиц в pg_restore -l > 200, ключевые таблицы и их данные
 │           есть в оглавлении, sha256 → бакет db-backups:
 │              runs/2026-11-14T00Z.dump + .manifest   хранится 21 (≈7 дней × 3)
 │              monthly/2026-11.dump + .manifest        первый успешный запуск месяца, хранится 12
 │              latest.dump, latest.manifest, latest.sha256
 ├─ storage  rclone sync бакета Storage → db-backups/storage/current/
 │           удалённое или перезаписанное в источнике → storage/deleted/<время>/ (30 дней)
 ├─ vps      (если задан VPS_BACKUP_HOST) rsync дампа, потом манифеста на VPS (ключ с rrsync -wo)
 └─ журнал   по строке на шаг в public.ops_backup_runs (ok, bytes, tables, sha256, object_key, error)

Портал: /api/cron/backup-freshness раз в час
   последний запуск kind=db упал                → CRITICAL «Бэкап базы не удался»
   успешного нет / последний успешный > 10 ч    → CRITICAL
   последняя копия Storage упала                → WARNING
   → notifyStaff: лента GIGA + Telegram сотрудников с settings.manage (= Super Admin)
     + старые чаты TELEGRAM_ADMIN_CHAT_IDS + письмо на ADMIN_NOTIFICATION_EMAIL (для CRITICAL).
   Об одной проблеме не чаще раза в 6 ч. Новая проблема (следующий упавший запуск) приходит сразу.
```

**Манифест** (`*.manifest`, текст `ключ=значение`) содержит имя, размер, sha256, число таблиц всего и по схемам `public`, `auth`, `storage`, а также точное число строк `public.profiles`, `public.companies`, `public.survey_answers` и `auth.users`. Строки посчитаны в том же снимке, что и дамп, поэтому при восстановлении они обязаны совпасть до единицы. По манифесту сверяются VPS и `restore-drill.sh`.

**Ротация** удаляет только свои имена: в `runs/` — `ГГГГ-ММ-ДДTЧЧZ.dump` и `.manifest`, в `monthly/` — `ГГГГ-ММ.dump` и `.manifest`. Каталог `daily/` и файлы старого скрипта не трогаются (см. §4). Время жизни объектов в бакетах Railway не поддерживается, поэтому старые копии удаляет сам скрипт.

**Коды выхода:** `0` — всё хорошо, `1` — бэкап базы не удался, `2` — база в порядке, но не удалась копия Storage или передача на VPS. Railway помечает запуск с кодом ≠ 0 как упавший.

**Секреты.** В коде нет ни одного. rclone настраивается только переменными окружения, так что ключи S3 не попадают на диск и в argv. Ключ SSH для VPS живёт в файле с правами 0600 до конца запуска. Логин и пароль в адресах баз маскируются во всех сообщениях. `set -x` не используется. Тест проверяет, что ключи и пароль не появляются ни в выводе, ни в argv `rclone`.

## 2. Переменные сервиса `db-backup`

Значения не записываются ни сюда, ни в отчёты: только имена и ссылки.

### Уже есть (используются как раньше)

| Переменная | Значение |
|---|---|
| `POSTGRES_PRIVATE_URL` | ссылка на Postgres-sfat (роль `supabase_admin`, приватная сеть) |
| `BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` | ссылки `${{db-backups.BUCKET}}` и т. д. на бакет `db-backups` |
| `BACKUP_SCRIPT` | старый скрипт. **Не удалять**: на нём держится откат (§5) |

### Добавить

| Переменная | Значение | Зачем |
|---|---|---|
| `BACKUP_SCRIPT_V2` | содержимое `scripts/backup/railway-db-backup.sh` из `main` (≈21 КБ) | новый скрипт |
| `BACKUP_SCRIPT_SHA256` | `shasum -a 256 scripts/backup/railway-db-backup.sh` | защита от обрезанной или чужой вставки |
| `STORAGE_BUCKET` | `${{<бакет Storage>.BUCKET}}` | бакет, где self-hosted Supabase Storage хранит файлы (~49 МБ) |
| `STORAGE_ENDPOINT` | `${{<бакет Storage>.ENDPOINT}}` | |
| `STORAGE_ACCESS_KEY_ID` | `${{<бакет Storage>.ACCESS_KEY_ID}}` | только чтение источника |
| `STORAGE_SECRET_ACCESS_KEY` | `${{<бакет Storage>.SECRET_ACCESS_KEY}}` | |
| `STORAGE_REGION` | `${{<бакет Storage>.REGION}}` | |

`<бакет Storage>` — имя сервиса-бакета Railway, в котором лежат файлы Storage. Его видно в переменных сервиса Supabase Storage: `GLOBAL_S3_BUCKET` / `GLOBAL_S3_ENDPOINT` ссылаются на него. Вместо ссылок на бакет можно сослаться на те же переменные сервиса Storage, например `${{<storage-сервис>.GLOBAL_S3_BUCKET}}`.

### По необходимости

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `S3_FORCE_PATH_STYLE` | `false` | `true`, если на вкладке Credentials бакета `db-backups` сказано path-style (так бывает у старых бакетов) |
| `STORAGE_FORCE_PATH_STYLE` | как `S3_FORCE_PATH_STYLE` | то же для бакета Storage |
| `BACKUP_MIN_BYTES` / `BACKUP_MIN_TABLES` | `1048576` / `200` | пороги проверки дампа |
| `BACKUP_KEEP_RUNS` / `BACKUP_KEEP_MONTHLY` | `21` / `12` | сколько хранить |
| `BACKUP_KEY_TABLES` | `public.profiles public.companies public.survey_answers auth.users` | таблицы, чьи строки считаются в манифест |
| `STORAGE_KEEP_DELETED_DAYS` | `30` | сколько хранить удалённые из Storage файлы |
| `STORAGE_SYNC_MAX_DELETE` | `500` | предохранитель: sync не уберёт больше файлов за раз |
| `BACKUP_DUMP_TIMEOUT` | `3600` | предел pg_dump в секундах |
| `VPS_BACKUP_HOST` | — | включает передачу на VPS; без неё шаг пропускается |
| `VPS_BACKUP_PORT` / `VPS_BACKUP_USER` | `22` / `a360backup` | |
| `VPS_SSH_KEY_B64` | — | приватный ключ ed25519 в base64 (`base64 -w0 a360push`) |
| `VPS_SSH_KNOWN_HOSTS` | — | строка `ssh-keyscan -t ed25519 <host>`; отпечаток сверить с сервером вручную |

**Зависимости в рантайме.** В образе `postgres:17` нет `rclone`, поэтому скрипт ставит его через `apt-get install rclone ca-certificates` (Debian bookworm, rclone 1.60). Это добавляет к каждому запуску примерно 20–40 с и ~20 МБ трафика. Для VPS скрипт так же доставит `rsync` и `openssh-client`. Позже можно собрать свой образ (Dockerfile на `postgres:17` с rclone) и убрать установку из рантайма. Остальное умеет и Debian bookworm, и `curl --aws-sigv4`, но для листинга (ListObjectsV2) и удаления пришлось бы руками разбирать XML и подписывать DELETE, поэтому выбран rclone.

## 3. Развёртывание (делает оркестратор после «да» PO)

1. **Миграция 142** на прод: `node scripts/apply-migration.js supabase/migrations/142_ops_backup_runs.sql`.
2. **Переменные** из §2 «Добавить» в сервис `db-backup`. Старые не трогать.
3. **startCommand** сервиса `db-backup`:
   ```
   bash -c 'printf "%s\n" "$(printenv BACKUP_SCRIPT_V2)" > /tmp/railway-db-backup.sh && echo "$BACKUP_SCRIPT_SHA256  /tmp/railway-db-backup.sh" | sha256sum -c --quiet && exec bash /tmp/railway-db-backup.sh'
   ```
   `$(printenv …)` срезает все завершающие переводы строки, а `printf "%s\n"` добавляет ровно один, как в файле репозитория. Так хеш сходится, даже если Railway при сохранении переменной съест или добавит перевод строки. Несовпадение хеша — запуск падает до любых действий: значит, скрипт вставлен не полностью.
4. **Расписание**: `30 0,8,16 * * *` (UTC) = 05:30 / 13:30 / 21:30 Алматы.
5. **Первый запуск руками** (Deploy / Run now) и проверка:
   - лог заканчивается строкой `ИТОГ: всё в порядке (runs/…dump)`;
   - в бакете есть `runs/<время>.dump`, `.manifest`, `latest.*`, `monthly/<месяц>.dump`, `storage/current/…`;
   - `SELECT kind, ok, bytes, tables, object_key, error FROM public.ops_backup_runs ORDER BY started_at DESC LIMIT 3;` возвращает `db` и `storage` с `ok = t`.
6. **Порталу** нужен деплой кода с этим кроном. Пока нет миграции 142, крон отвечает `503 migration_142_required` и никого не будит. Если миграция применена, а успешной строки ещё нет, через час придёт «Нет ни одного успешного бэкапа». Поэтому пункты 1 и 5 делаются один за другим.
7. Через 7 дней успешной работы старые `daily/day-1..7.dump` можно удалить руками (по решению PO). `monthly/` старого скрипта остаются и участвуют в общей ротации, если их имена совпадают с `ГГГГ-ММ.dump`.

## 4. Восстановление

### 4.1 Взять дамп из бакета

На машине с rclone задайте те же переменные `RCLONE_CONFIG_A360DST_*`, что выставляет скрипт (тип s3, provider Other, endpoint, region, ключи бакета `db-backups`), и выполните:

```bash
rclone copyto a360dst:<BUCKET>/latest.dump      ./latest.dump
rclone copyto a360dst:<BUCKET>/latest.manifest  ./latest.manifest
rclone copyto a360dst:<BUCKET>/latest.sha256    ./latest.sha256
sha256sum -c latest.sha256            # latest.dump: OK
# другой момент: rclone lsf a360dst:<BUCKET>/runs/  и  monthly/
```

### 4.2 Восстановить рядом и сверить (точечное восстановление и учение)

```bash
PG_BIN=/usr/lib/postgresql/17/bin scripts/backup/restore-drill.sh \
  --dump ./latest.dump --manifest ./latest.manifest \
  --target-admin-url postgres://<user>@<host>:<port>/postgres \
  --name a360_restore_<дата> --keep
```

Скрипт проверит sha256 и размер, создаст **новую** базу (существующую не тронет), выполнит `pg_restore --no-owner --no-acl` и сверит число таблиц по схемам и строки ключевых таблиц с манифестом. Из восстановленной базы нужные строки переносятся в рабочую вручную, `INSERT … SELECT` через `dblink` или `\copy`.

### 4.3 Полное восстановление прода (катастрофа)

Этот сценарий не отрепетирован. Перед первым реальным применением его нужно прогнать на отдельном окружении Railway.

1. Включить режим техработ портала.
2. Создать новый сервис Postgres из того же образа Supabase, что `Postgres-sfat` (там уже есть роли `supabase_admin`, `authenticated` и другие).
3. `pg_restore --clean --if-exists --jobs=2 --dbname=<новый>/postgres latest.dump` от имени `supabase_admin`, то есть с владельцами и правами, как `restore-drill.sh --exact`.
4. Сверить с манифестом: `restore-drill.sh` умеет это для базы с новым именем, а для `postgres` хватит запросов из манифеста.
5. Переключить ссылки `DATABASE_URL`, `DIRECT_URL` и `POSTGRES_*` у сервисов portal, agents, auth, rest, storage, realtime и db-backup на новый Postgres. Файлы Storage вернуть: `rclone sync a360dst:<BUCKET>/storage/current a360src:<STORAGE_BUCKET>`.
6. Снять режим техработ и проверить вход, анкету и документы.

### 4.4 Учение восстановления — результат 2026-11-14 (локально)

Учение прошло на локальной тестовой Postgres 17.10 (`127.0.0.1:54329`):

| Прогон | Источник | Дамп | Восстановление | Сверка |
|---|---|---|---|---|
| 1 | `aistart360_test` (все миграции до 142) | 1,25 МБ, 364 таблицы в оглавлении, 1 с | 1 с, `--no-owner --no-acl`, 0 ошибок, база 19 МБ | public 179/179, auth 1/1, storage 2/2; строки 0/0 ✓ |
| 2 | копия с данными: 500 users / 500 profiles / 300 companies / 4000 survey_answers | 1,43 МБ | 1 с, 0 ошибок, 22 МБ | все 4 счётчика строк совпали ✓ |
| 3 | то же, `--exact` (с владельцами и правами) | 1,43 МБ | 1 с, 0 ошибок | ✓ |
| 4 | испорченный дамп (1 байт) | — | — | отказ: «sha256 не совпадает с манифестом» ✓ |

Также прогнан приём на VPS (`receive-and-restore.sh` на macOS-заменителях `stat`/`find`/`age`/`flock`). Два дампа восстановлены, `a360_current` переключилась, предыдущая база получила имя `a360_20261113t08z`. Третий дамп удалил самую старую базу (держим 2). Дамп с неверным счётчиком строк ушёл в `incoming/failed`, манифест без дампа тоже. Архив и месячная копия создались.

Повторить учение (база-источник — локальная тестовая, на прод не направлять):

```bash
PG_BIN=/opt/homebrew/opt/postgresql@17/bin scripts/backup/restore-drill.sh \
  --source-url postgres://postgres@127.0.0.1:54329/aistart360_test \
  --target-admin-url postgres://postgres@127.0.0.1:54329/postgres
```

## 5. Откат на старый скрипт

1. startCommand `db-backup` → `bash -c 'eval "$BACKUP_SCRIPT"'`.
2. Расписание → `30 0 * * *`.
3. Переменные `BACKUP_SCRIPT_V2`, `BACKUP_SCRIPT_SHA256` и `STORAGE_*` можно оставить: старый скрипт их не читает.
4. Файлы нового формата (`runs/`, `latest.manifest`, `storage/`) старому скрипту не мешают. `latest.dump` он перезапишет своим.
5. Сторож портала после отката будет каждые 6 ч сообщать «Бэкапа базы нет дольше 10 ч»: старый скрипт не пишет в журнал. Это честный сигнал. Чтобы его заглушить, снимите крон `/api/cron/backup-freshness` из `lib/cron/schedule.ts` или откатите миграцию 142 (`DROP TABLE public.ops_backup_runs`), и крон начнёт отвечать 503.

## 6. Резервный сервер (VPS)

Установка, ключи, уведомления и восстановление из зашифрованного архива описаны в [`scripts/backup/vps/README.md`](../../scripts/backup/vps/README.md). Со стороны Railway для VPS нужны четыре переменные: `VPS_BACKUP_HOST`, `VPS_SSH_KEY_B64`, `VPS_SSH_KNOWN_HOSTS` и при необходимости `VPS_BACKUP_PORT`. Пока они не заданы, шаг `vps` пропускается.
