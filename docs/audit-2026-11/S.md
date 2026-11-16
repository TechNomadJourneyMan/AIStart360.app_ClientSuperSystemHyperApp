# Раунд 1б, исполнитель S: staging заполнен обезличенной копией прода

Дата: 2026-11-14. Источник: `cloud-supabase-final-20261113T2030Z.dump` (прод на 12.11). Цель: staging-Postgres
`<staging-db-proxy>` (`sslmode=disable`). К проду ни одного подключения не было.
Railway использовался один раз: `railway ssh -e staging -s Postgres-sfat`, только чтение счётчиков,
когда пропал файл пароля. Дамп не копировался и в SQL на диск не распаковывался: pg_restore отдавал поток прямо в psql.

## Итог

- **Данные загружены и обезличены одной транзакцией** (`scripts/staging/load.sh`, 05:54–06:05 UTC). Внутри
  транзакции `verify-pii.sql` проверил результат: **17 групп проверок, 0 нарушений**. COMMIT прошёл только после этого.
  Необезличенные данные в staging не фиксировались ни разу. Все пробные прогоны шли в транзакциях
  с ROLLBACK или откатом к SAVEPOINT; перед итоговой заливкой подтверждено, что в `auth.users` 0 строк.
- `verify-pii.sql`, запущенный отдельно после фиксации и после миграций: **0 нарушений**.
- Миграции 140, 141 и 142 применены к staging **без ошибок**, записаны в `public.schema_migrations` (applied_by `staging-psql`).
- Права (ACL) public и market **совпадают с продом построчно**: 1 023 GRANT/REVOKE.

## Шаги

1. Состав дампа (`pg_restore -l`). Расширения: `vector` и `btree_gist` в public; `postgis`, `citext`,
   `pg_trgm` и `unaccent` в market; `pgcrypto`, `uuid-ossp` и `pg_stat_statements` в extensions.
   Схемы public (239 таблиц) и market (27). В auth — данные users (68) и identities (71).
   Триггер `on_auth_user_created`, 7 политик `storage.objects`, 6 бакетов, 18 таблиц в публикации
   `supabase_realtime`. Дамп снят с `--no-privileges`.
2. Подготовка (`01-prepare.sql`):
   - предохранитель: `auth.users` = 0 и `public.profiles` пуст;
   - метка `COMMENT ON DATABASE postgres IS 'aistart360-staging'` (её требуют `anonymize.sql`, `reset.sql` и `apply-migration.sh`);
   - роли `aistart360_omnichannel_runtime` и `market_app` с NOLOGIN: на них ссылаются 14 политик и гранты прода;
   - схема market и расширения в тех же схемах, что в проде.
3. DDL public/market (pre-data, `--role=postgres`) — отдельно, без данных.
4. Одна транзакция:
   1. данные `auth.users`, потом `auth.identities`;
   2. данные public/market;
   3. post-data: индексы, ключи, RLS, политики, триггеры, публикация;
   4. `anonymize.sql` и `verify-pii.sql`;
   5. `03-post.sql`: бакеты, политики storage, триггер;
   6. `04-privileges.sql`: сброс прав и ACL прода;
   7. COMMIT.
5. Миграции 140/141/142 через `scripts/staging/apply-migration.sh`: psql `-1 ON_ERROR_STOP` плюс запись в журнал
   в той же транзакции (file, sha256, applied_by — как `scripts/apply-migration.js`). Миграции до 139
   включительно уже есть в журнале дампа: 63 файла, 083–139 полностью. Миграция 139 в дампе учтена.

## Проблемы и решения

1. **Система очистила scratchpad**, вместе с ним пропал файл пароля. Состояние я проверил через
   `railway ssh -e staging`, только счётчики: данных нет, `auth.users` = 0, есть только справочник postgis.
   После нового пути к паролю работа продолжилась. Рабочие файлы теперь лежат в `~/.a360-test/work-S`;
   там только списки TOC и счётчики, ни ПДн, ни пароля.
2. Дамп содержит запись данных `market.spatial_ref_sys` (0 строк), но таблица принадлежит расширению postgis.
   COPY от роли postgres падает с `permission denied`. Решение: запись исключена из списка.
3. В первом прогоне `auth.identities` грузилась раньше `users`: `identities_user_id_fkey`. Решение: явный порядок в списке.
4. Storage в staging старее облачного: в `storage.buckets` нет колонок `versioning_status` и `lifecycle_*`.
   Решение: бакеты вставляются явным INSERT по общим 11 колонкам.
5. GoTrue в staging старее: последняя миграция 20260302 против 20260831 в дампе, нет таблиц `mfa_recovery_*` и `scim_*`.
   Колонки `users`/`identities` дампа есть в цели все; у цели сверх того только генерируемые `confirmed_at` и `email`.
   Сессии, MFA и прочее не переносятся по замыслу.
6. Гранты (дамп с `--no-privileges`). ACL снят с резервной копии Railway-прода от 05.11
   (`acl-public-market.sql`); наборы таблиц и функций там и в дампе от 12.11 совпадают.
   `04-privileges.sql` сначала сбрасывает права, иначе default privileges образа дали бы anon ALL на всё, затем применяет ACL.
7. CHECK-ограничения:
   - хэши должны быть sha256-hex — перехеш теперь тоже sha256-hex с солью;
   - `ai_credentials.secret_ciphertext LIKE 'v1:%'` — ставится `v1:staging-redacted`;
   - `integration_connections` требует согласованности секрета и статуса — ставится `disconnected`;
   - `company_members.role` ломала общая чистка: роль `owner` совпала с именем. Исправлено стоп-словами
     и тем, что перечислимые текстовые колонки (role, status, type…) не чистятся.
8. Регулярка телефонов ложно срабатывала внутри hex-ключей. Границы заменены на «не буква и не цифра»; колонки `*_key` в общей чистке не трогаются.
9. Нашлась вторая анкета (медицинская) с контактами, где `medical_phone` хранится числом. Ключи контактов
   вынесены в таблицу `_ck`: company / person / email / null. По ним обрабатываются `survey_answers`,
   `survey_answer_history` и `point_a_values` (`survey.<ключ>`, `company.name`).
10. TRUNCATE не допускает внешних ссылок. Поэтому для очищаемых таблиц: ссылки из сохраняемых таблиц → NULL
    (`expert_cases.comm_thread_id`, `ai_pending_actions.conversation_id` и др., найдены автоматически по pg_constraint),
    затем DELETE при `session_replication_role = replica`.
11. В отладочном сеансе zsh-`echo` превратил `\echo` в мусор, и транзакция прервалась. Сделан ROLLBACK, ничего не зафиксировано.

## Сверка (дамп → staging)

| Что | Дамп | Staging после загрузки | После 140–142 |
| --- | --- | --- | --- |
| auth.users / identities | 68 / 71 | 68 / 71 (google 10, email 61) | — |
| Таблиц public / market | 239 / 27 (+spatial_ref_sys) | 239 / 28 | 240 (+`ops_backup_runs`) / 28 |
| Строки public+market | 266 таблиц | **240 таблиц — строка в строку**; 26 очищенных — 0 строк (всего удалено 2 839 строк) | — |
| RLS включён (public) | 237 таблиц | 237 из 239 (без RLS, как в проде: `aistart360_schema_releases`, `aistart360_store_financial_releases`; anon/authenticated к ним доступа не имеют) | 238 из 240 |
| Политики public / market / storage | 266 / 7 / 7 | 266 / 7 / 7 | 268 / 7 / 7 |
| Функции public (без объектов расширений) | 127 | 127 | 134 (новые функции 140) |
| Триггеры public+market | 113 | 113 | 113 |
| `on_auth_user_created` | 1 | 1 | 1 |
| Таблицы в `supabase_realtime` | 18 | 18 | 18 |
| ACL public+market | 1 023 (прод 05.11) | 1 023, `comm` — 0 расхождений | — |
| `schema_migrations` | 63 (083–139) | 63 | 66 |
| storage.buckets / objects | 6 / 57 | 6 / 0 (файлы не переносились) | — |

Строки ключевых таблиц: profiles 64, companies 22, survey_answers 1 462, survey_answer_history 2 175, documents 42,
metrics 471, diagnostics 97, gri_assessments 22, point_a_values 141, patient_segments 8 235, market.companies 76. Всё совпадает с дампом.

Права после загрузки (таблиц public с SELECT / INSERT): anon 106 / 84, authenticated 136 / 86, service_role 226 / 216
(после 142: 227 / 217). Это права прода; доступ к строкам дальше режет RLS.

## Очищено полностью (26 непустых таблиц, 2 839 строк; плюс пустые из того же списка)

- Переписка и ИИ-диалоги: `comm_messages` (2), `comm_threads` (1), `omnichannel_contacts` (234), `omnichannel_conversations` (234),
  `omnichannel_messages` (783), `omnichannel_outbound_payloads` (295), `omnichannel_outbound_deliveries` (295),
  `omnichannel_processing_jobs` (430), `ai_messages` (22), `ai_conversations` (9), `assistant_events` (208),
  `assistant_runs` (2), `ai_journey_messages` (6). Пустые: `comm_campaigns*`, `assistant_*`, `bot_ai_messages`,
  `omnichannel_webhook_events`, `omnichannel_telegram_bots`. `omnichannel_settings` оставлен; в нём только общая чистка.
- Токены и секреты: `user_security` (2FA, 2), `ai_journey_device_credentials` (3), `accounts` (1), `rate_limit_hits` (6).
  Пустые: `shared_reports`, `pb_invites`, `webauthn_credentials`, `mcp_tokens`, `oauth_*`, `sessions`,
  `verification_tokens`, `ai_journey_connect_codes`, `idempotency_records`.
- Приглашения персонала: `platform_invitations` (5).
- Telegram и WhatsApp: `staff_telegram_links` (1), `telegram_bot_updates_seen` (16), `whatsapp_bridge_commands` (2),
  `whatsapp_bridge_status` (1); пустые `telegram_*`, `whatsapp_links`, `whatsapp_outbox`, `myhonor_order_notifications`.
- Письма и имперсонация: `email_deliveries` (34), `impersonation_sessions` (22).
- Документы: `document_chunks` (222), `document_summaries` (3).
- auth: `sessions`, `refresh_tokens`, `mfa_*`, `one_time_tokens`, `flow_state`, `audit_log_entries` (из дампа не грузились; в staging пусто).

Решение по журналам: `admin_audit_log` (380), `activity_log` (23), `audit_logs`, `financial_audit_events` и `market.audit_log`
**оставлены**, потому что нужны для разработки аудита. IP и user-agent → NULL; e-mail и имена внутри заменены общей чисткой.

## Колонки с ПДн по именам (information_schema: email/phone/name/contact/telegram/whatsapp/instagram/address/iin/bin/inn/avatar/ip/user_agent) — решение по каждой

| Колонки | Решение |
| --- | --- |
| `auth.users.email/phone/*_token/raw_user_meta_data/encrypted_password`, `auth.identities.identity_data/provider_id` | e-mail → `user-N@staging.aistart360.test`, телефон → NULL, токены → `''`. В meta остаются только role/vertical/locale/email_verified/phone_verified/tier (+email и «Пользователь N»). Пароль — случайный bcrypt. Google-ID → `staging-google-N-k`. |
| `profiles.email/full_name/phone/avatar_url/organization/telegram_*` | e-mail как в auth, «Пользователь N», «Организация N»; остальное NULL. |
| `companies.name/contact_name/contact_email/contact_phone/contact_position/notes/domain` | «Компания N»; остальное NULL. |
| `users.email/name/avatarUrl/image/passwordHash` (legacy) | `legacy-user-N@…`, «Пользователь», NULL, случайный bcrypt. |
| `clients.name/website/notes`, `organizations.name/slug`, `crm_clients.*`, `report_documents.client_name`, `sales.manager_name_snapshot` | «Клиент N» / «Организация N» / `org-N`; контакты → NULL. |
| `mini_gri_leads.email`, `market.users.email`, `user_notes.author_email` | `lead-N@…`, `market-user-N@…`, staging-адрес; `user_notes.body` → «[заметка обезличена]». |
| `admin_audit_log.actor_email/ip_address/user_agent`, `activity_log.ip_address/user_agent`, `audit_logs.ipAddress`, `financial_audit_events.ip_address/user_agent`, `market.audit_log.ip/user_agent` | e-mail → карта; IP и UA → NULL. |
| `impersonation_sessions.admin_email/ip/ua`, `platform_invitations.email/invited_by_email/company_name`, `omnichannel_contacts.phone/display_name`, `whatsapp_*.phone_e164`, `myhonor_order_notifications.recipient_*`, `telegram_*`, `staff_telegram_links.*`, `comm_messages.author_name` | Таблицы очищены. |
| `patient_segments.display_name` (8 235) | «Пациент N»; `patient_hash` → sha256 с солью. |
| `market.companies.email/phone/bin/inn/name` | email/phone/founders/directors/raw → NULL; БИН ИП → NULL; названия юрлиц из госреестра оставлены. |
| `market.persons.full_name/iin/contacts` | «Персона N», NULL (в дампе 0 строк). |
| `documents.file_name`, `import_jobs.file_name`, `store_import_runs.source_file_name` | Оставлены (файлов нет), только общая чистка. |
| Имена товаров, складов, каналов, регионов, статей расходов, провайдеров ИИ (`*_products.name`, `store_*.name`, `sales_*.name` и т.п.) | Не ПДн, оставлены. |
| `pb_*.*_name`, `point_a_*.*_name`, `point_b_versions.author_name`, `market.sanctions_list.full_name` | В дампе пусто; общая чистка всё равно применяется. |
| `survey_answers.answer` | По ключам (таблица `_ck`): `s1_company_name`/`medical_clinic_name` → «Компания N»; `s1_contact_name`/`medical_full_name`/`s9n_responsible_person` → «Пользователь N»; `s1_contact_email`/`medical_email` → staging-адрес; `s1_contact_phone`/`medical_phone`/`s1_website`/`s1_social_media`/`medical_clinic_website`/`ec_website` → `{"value": null}`. `s1_contact_position` оставлен. Числа не тронуты. |
| `documents.parsed_data`, `ai_extractions.raw_excerpt`, `point_a_values.source_fragment` | NULL (извлечённый текст). |
| Секреты: `ai_credentials.secret_ciphertext`, `crm_integrations.accessToken/refreshToken/webhookUrl`, `crm_provider_connections.access_token`, `integration_connections.*_ciphertext`, `market.forecasts.share_token`, `ai_journey_workspaces.access_token_hash`, `ecommerce_orders.customer_hash` | `v1:staging-redacted` (выкл.), `staging-redacted`/NULL, неактивны, NULL, перехеш. |
| Общая чистка: все text/varchar/jsonb (вместе с ключами)/text[] колонки public и market | e-mail → карта или `redacted@staging.aistart360.test`; телефоны → `+70000000000`; исходные ФИО и названия → подписи; слова ФИО → «[имя]». |

## Проверки «ПДн не осталось» (`verify-pii.sql`)

Результат: **0 нарушений**. Внутри транзакции загрузки — 17 групп проверок плюс проверка исходных имён; отдельно после
фиксации и после миграций 140–142 — то же. Что проверяется:
- e-mail вне `@staging/@dev.aistart360.test` во **всех** текстовых, jsonb и массивных колонках public и market,
  а также в `auth.users` и `auth.identities` (не только в колонках `email`);
- телефоны (`+<10–14 цифр>`, `8 7xx…`, `7[07]xxxxxxxxx`, кроме заглушки) во всех тех же колонках;
- auth: e-mail, телефон, все токены, ключи имён/телефонов/аватаров в meta, e-mail в identities = users, Google-ID заменены;
- профили (e-mail, ФИО, контакты, telegram), компании, контакты анкеты, `parsed_data`, IP/UA журналов, секреты интеграций,
  пациенты, люди в market;
- очищенные таблицы пусты (public и auth);
- исходные ФИО и названия компаний нигде не встречаются; названия компаний допускаются только в технических идентификаторах (ниже).

## Оставлено сознательно

Слаги бренда клиента в технических идентификаторах: `company_id` вида `<бренд>-<hex>` (~30 таблиц, e-commerce/склад/метрики),
`source`, `sku`, внешние id и URL товаров, имена и пути файлов документов. Это идентификаторы компании, а не персональные
данные; замена означала бы переписать ключи во всех связанных таблицах. В описательных полях названия заменены.

## Миграции на staging

| Файл | Результат |
| --- | --- |
| `140_staff_rls_from_staff_roles.sql` | ✓ без ошибок; 8 функций (current_staff_role, is_platform_admin, …) на месте |
| `141_ai_messages_client_insert_user_only.sql` | ✓ без ошибок (NOTICE «policy … does not exist, skipping» ×3 — ожидаемо, идемпотентные DROP); политики `ai_messages_owner_select/insert_user/delete` созданы |
| `142_ops_backup_runs.sql` | ✓ без ошибок; RLS вкл., anon/authenticated — нет прав, service_role — есть |

## Файлы

Репозиторий (не закоммичено мной; часть уже попала в WIP-коммиты оркестратора):
- `scripts/staging/01-prepare.sql`, `load.sh`, `anonymize.sql`, `verify-pii.sql`, `03-post.sql`, `04-privileges.sql`,
  `acl-public-market.sql`, `verify.sql`, `reset.sql`, `apply-migration.sh`;
- `docs/staging/README.md`.

Секретов в файлах нет: пароль читается из файла, его путь передаётся переменной `STAGING_PG_PASSWORD_FILE`.

## Замечания

- `reset.sql` написан, но против staging **не запускался**: данные загружены на пустую базу.
- Пароли пользователей в staging случайные. Вход — через dev-панель или сервисный ключ. Письма GoTrue уходят на несуществующий домен `.test`.
- Ключи AI-провайдеров и интеграций в staging выключены (`v1:staging-redacted`). Если в staging нужен ИИ, ключи надо завести заново.
- В оркестраторе фигурировало «240 таблиц public до загрузки». Фактически было 239; 240 — после миграции 142.
