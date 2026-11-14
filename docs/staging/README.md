# Staging (AIStart360)

Staging — отдельное окружение `staging` в Railway-проекте портала: свой self-hosted Supabase
(Postgres `supabase/postgres` 17, GoTrue, PostgREST, Storage, Realtime, Envoy). Здесь проверяют
изменения, прежде чем они попадут в прод. В базе лежит **обезличенная** копия прод-данных.

## Адреса

| Что | Адрес |
| --- | --- |
| API Supabase (Envoy) | `https://envoy-staging-2d1d8e5b.up.railway.app` |
| База (TCP-прокси staging) | `junction.proxy.rlwy.net:48460`, БД `postgres`, пользователь `supabase_admin`, **`sslmode=disable`** (сервер не поддерживает TLS; трафик открытый, поэтому в базе только обезличенные данные) |
| Пароль `supabase_admin` | хранится вне репозитория (файл с правами 600); в командную строку, логи и файлы не попадает |

Прод (`reseau.proxy.rlwy.net`, `postgres-sfat.railway.internal`, `supabase.aistart360.app`,
облачный `*.supabase.co`) скрипты staging не трогают. Railway-команды для staging — только с `-e staging`.

## Правило

**Прод-данные попадают в staging только через `scripts/staging/load.sh`.** Он загружает данные
и обезличивает их в одной транзакции: `anonymize.sql`, затем `verify-pii.sql`. Если после
обезличивания нашлись ПДн или секреты, `verify-pii.sql` бросает исключение, и вся загрузка
откатывается. Неполностью обезличенных данных staging не видит даже временно.
Никаких `pg_restore` / `COPY` прод-данных мимо этого скрипта. Сам дамп не копировать
и не распаковывать в SQL-файл: pg_restore отдаёт поток прямо в psql.

## Скрипты (`scripts/staging/`)

| Файл | Что делает |
| --- | --- |
| `01-prepare.sql` | Предохранитель: в `auth.users` должно быть 0 строк, а `public.profiles` должен быть пуст. Ставит метку `COMMENT ON DATABASE postgres IS 'aistart360-staging'` и создаёт роли `aistart360_omnichannel_runtime` и `market_app` (NOLOGIN, на них ссылаются политики и гранты). Создаёт схему `market` и расширения в тех же схемах, что в проде: `vector` и `btree_gist` в `public`, `postgis`, `citext`, `pg_trgm` и `unaccent` в `market`. |
| `load.sh <дамп>` | Полная заливка, см. ниже. |
| `anonymize.sql` | Обезличивание, идемпотентное. Требует суперпользователя и метку staging. |
| `verify-pii.sql` | Проверка «ПДн не осталось»: печатает только счётчики. При нарушении бросает EXCEPTION. |
| `03-post.sql` | Строки 6 бакетов storage (без файлов), 7 политик `storage.objects`, триггер `on_auth_user_created`. |
| `04-privileges.sql` + `acl-public-market.sql` | Права как в проде. Сначала права на объекты public и market сбрасываются: дамп снят с `--no-privileges`, а default privileges образа дали бы anon «всё на всё». Затем применяются 1 023 GRANT/REVOKE из ACL резервной копии Railway-прода от 05.11. |
| `apply-migration.sh <файл>` | Применяет миграцию к staging (хост зашит, нужна метка staging) и записывает её в `public.schema_migrations` в той же транзакции. |
| `verify.sql` | Сверка: таблицы, строки ключевых таблиц, RLS, политики, функции, триггеры, realtime, права ролей. |
| `reset.sql` | Очистка staging перед повторной заливкой (только с меткой staging и `-v confirm=staging`). |

## Как переналить staging заново

```bash
PW=~/AI-Portal-backups/staging-secrets/pg     # файл с паролем supabase_admin staging
STG="host=junction.proxy.rlwy.net port=48460 dbname=postgres user=supabase_admin sslmode=disable"

# 1. очистить (только staging; спросит метку и confirm)
PGPASSWORD="$(cat "$PW")" psql "$STG" -X -v ON_ERROR_STOP=1 -v confirm=staging -1 -f scripts/staging/reset.sql

# 2. залить и обезличить (одна транзакция), затем сверка
STAGING_PG_PASSWORD_FILE="$PW" scripts/staging/load.sh ~/AI-Portal-backups/<свежий-дамп>.dump

# 3. миграции, которых нет в дампе (сравните supabase/migrations с public.schema_migrations), — по одной:
STAGING_PG_PASSWORD_FILE="$PW" scripts/staging/apply-migration.sh supabase/migrations/140_staff_rls_from_staff_roles.sql
```

Миграции в staging применяются через psql с явной строкой подключения staging. Не используйте
`scripts/apply-migration.js`: он берёт `DIRECT_URL` из `.env.local`, а это может быть прод.
Запись в `schema_migrations` повторяет `apply-migration.js`: имя файла, sha256 содержимого и автор.

Что делает `load.sh`:
1. `01-prepare.sql`;
2. DDL public/market (pre-data) — отдельно, без данных;
3. **одна транзакция**: данные `auth.users` и `auth.identities` (сначала users), данные public/market,
   post-data (индексы, ключи, RLS, политики, триггеры, таблицы публикации `supabase_realtime`),
   затем `anonymize.sql` → `verify-pii.sql` → `03-post.sql` → `04-privileges.sql`, COMMIT;
4. `verify.sql`.

Из `auth` переносятся только `users` и `identities`. Сессии, токены, MFA, `flow_state` и журнал
GoTrue не переносятся. Объекты storage тоже не переносятся: в staging есть только строки бакетов.

## Что обезличено

**auth**
- `auth.users`: e-mail → `user-<N>@staging.aistart360.test`, где N — порядковый номер по `created_at`, стабилен между заливками.
  `phone` → NULL. `confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`
  и `reauthentication_token` → `''`. `raw_user_meta_data` → только `role`/`vertical`/`locale`/`email_verified`/`phone_verified`/`tier`
  (+ `email`, `full_name = «Пользователь N»`, если ключи были). `encrypted_password` → **случайный bcrypt**:
  пароль никто не знает, вход только через dev-панель портала.
- `auth.identities`: `identity_data` = `{sub, email, email_verified, phone_verified}` с e-mail как в users;
  Google-ID (`provider_id`/`sub`) → `staging-google-<N>-<k>`.

**public (точечно)**
- `profiles`: e-mail как в auth; `full_name` → «Пользователь N»; `organization` → «Организация N»;
  `phone`, `avatar_url`, `telegram_*` → NULL. `position` и `expert_title` остаются.
- `companies`: `name` → «Компания N»; `contact_*`, `notes`, `domain` → NULL. Цифры бизнеса остаются.
- `survey_answers`. Ключи взяты из `lib/survey/questions.ts`, медицинской и e-commerce-анкет; таблица `_ck` в `anonymize.sql`.
  - `s1_company_name` и `medical_clinic_name` → «Компания N».
  - `s1_contact_name`, `medical_full_name` и `s9n_responsible_person` → «Пользователь N».
  - `s1_contact_email` и `medical_email` → staging-e-mail.
  - `s1_contact_phone`, `medical_phone`, `s1_website`, `s1_social_media`, `medical_clinic_website` и `ec_website` → `{"value": null}`.
  - `survey_answer_history`: по этим ключам старое и новое значения → «[обезличено]».
  - `point_a_values` с `field_key = survey.<тот же ключ>` и `company.name`: `raw_value` → NULL, `normalized_value` — та же замена.
  - Остальные ответы, включая все числа, остаются.
- `users` (legacy NextAuth): e-mail → `legacy-user-N@…`, имя → «Пользователь», `passwordHash` → случайный bcrypt, аватар → NULL.
- `clients`, `organizations`, `crm_clients`, `report_documents.client_name`, `sales.manager_name_snapshot` → обезличенные подписи или NULL.
- `mini_gri_leads.email` → `lead-N@…`; `market.users.email` → `market-user-N@…`.
- `user_notes`: `author_email` → staging, `body` → «[заметка обезличена]».
- Журналы `admin_audit_log`, `activity_log`, `audit_logs`, `financial_audit_events`, `market.audit_log`: строки
  **сохранены** (нужны для разработки аудита), `ip_address`/`ip` и `user_agent` → NULL, e-mail внутри — замена.
- `documents`: строки, имена и пути файлов сохранены (самих файлов нет); `parsed_data` → NULL.
  `ai_extractions.raw_excerpt` и `point_a_values.source_fragment` (фрагменты документов) → NULL.
- `patient_segments`: `display_name` → «Пациент N», `patient_hash` → `stg_<md5 с солью>`. Сегменты и суммы остаются.
- `ecommerce_orders.customer_hash`, `ai_journey_workspaces.access_token_hash`, `mcp_tokens.token_hash` → перехеш с солью.
- Секреты: `ai_credentials.secret_ciphertext` → `staging-redacted` (выключены; ключи AI в staging заводятся заново),
  `crm_integrations`/`crm_provider_connections` — токены `staging-redacted`, неактивны; `integration_connections` — шифротексты NULL;
  `market.forecasts.share_token` → NULL.
- `market.companies` (данные госреестра): названия остаются; `founders`, `directors`, `email`, `phone`, `raw` → NULL;
  БИН ИП (это ИИН человека) → NULL. `market.persons` → «Персона N», ИИН и контакты → NULL.

**public (общая чистка всех текстовых, jsonb и массивных колонок public и market)**
- любой e-mail → замена из карты (тот же staging-адрес) или `redacted@staging.aistart360.test`;
- телефоны (`+7…`, `8 7xx…`, `77xxxxxxxxx`, `+<10–14 цифр>`) → `+70000000000`;
- исходные ФИО, названия компаний и организаций → те же подписи («Пользователь N», «Компания N»…);
  отдельные слова ФИО (с заглавной буквы, ≥ 4 букв) → «[имя]».

**Очищено полностью (строк нет)**
- переписка и омниканал: `comm_*`, `omnichannel_*` (кроме `omnichannel_settings`), `ai_messages`, `ai_conversations`,
  `assistant_*`, `bot_ai_messages`, `ai_journey_messages`;
- токены и секреты: `shared_reports`, `pb_invites`, `platform_invitations`, `user_security` (2FA), `webauthn_credentials`,
  `mcp_tokens`, `oauth_*`, `accounts`, `sessions`, `verification_tokens`, `ai_journey_device_credentials`,
  `ai_journey_connect_codes`, `idempotency_records`, `rate_limit_hits`;
- Telegram и WhatsApp: `telegram_*`, `staff_telegram_links`, `whatsapp_*`, `myhonor_order_notifications`;
- `email_deliveries`, `impersonation_sessions`, `document_chunks`, `document_summaries`;
- auth: `sessions`, `refresh_tokens`, `mfa_*`, `one_time_tokens`, `flow_state`, `audit_log_entries`.

Ссылки из сохраняемых таблиц на очищенные (например, `expert_cases.comm_thread_id`) → NULL.

**Что сознательно оставлено**
- Слаги брендов в технических идентификаторах: `company_id` вида `<бренд>-<hex>`, `source`, `sku`, внешние id,
  URL товаров, пути и имена файлов документов. Это идентификаторы компаний, а не персональные данные. Их замена
  потребовала бы переписать ключи в ~30 таблицах. В описательных полях названия компаний заменены.
- Названия компаний из госреестра в `market.companies` (публичные данные юрлиц).
- Цифры бизнеса: выручка, метрики, ответы анкеты, финмодель, продажи, остатки.

**Повторный запуск `anonymize.sql`** даёт те же подписи и адреса (N стабилен). Но при каждом запуске
заново выбирается случайный пароль, а хэши `patient_hash`, `customer_hash` и `access_token_hash`
перехешируются с новой солью. Формат sha256-hex сохраняется, связи внутри таблиц тоже.

**Проверка** (`verify-pii.sql`, 17 групп проверок):
- e-mail вне `@staging/@dev.aistart360.test` во всех текстовых, jsonb и массивных колонках public и market, а также в `auth.users` и `auth.identities`;
- телефоны во всех тех же колонках;
- токены и метаданные auth;
- контакты профилей и компаний, контакты в анкете;
- `parsed_data`, IP и user-agent в журналах, секреты интеграций;
- пустота очищенных таблиц;
- в той же сессии, что `anonymize.sql`: отсутствие исходных ФИО и названий компаний (с поправкой на технические идентификаторы).

## Как войти

Пароли у всех пользователей случайные. В staging входят через dev-вход портала или через
сервисный ключ. Реальных адресов в базе нет, поэтому письма GoTrue (подтверждение, сброс пароля)
до людей не дойдут.
