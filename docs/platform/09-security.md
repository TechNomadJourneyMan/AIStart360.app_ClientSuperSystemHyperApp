# 09 — Безопасность

Назначение: единый приоритизированный список рисков со статусом, позиция по prompt injection и план тестов изоляции тенантов.
Обновлено: 2026-10-06 (вечер)

Источники: аудит 05 (§10), 01 (§7, R1–R20), 03 (файлы, вебхуки), 04 (вебхуки, SSRF). Репозиторий публичный (`.gitignore:26`) — миграции и маршруты видны атакующему.
Статусы: **083** — исправлено в миграции 083 (код ✅, прод ⛔ B1); **Phase N** — запланировано ([08](08-implementation-plan.md)); **владелец** — нужен ввод или решение. `[verify live]` — зависит от настроек прода.

## 1. P0

| ID | Риск | Доказательство | Статус |
|---|---|---|---|
| P0-1 | Самоназначение super_admin/admin/expert при регистрации: `handle_new_user` брал `role/status` из `raw_user_meta_data`, не-client роль одобрялась автоматически → полный GIGA-CRM (impersonation, роли, PII, документы) | `002_fix_user_trigger_status.sql:13-20` → `lib/admin/giga-actor.ts:55-56`; предусловие — публичные регистрации GoTrue (Google OAuth signup используется, `stores/auth.store.ts:210`) | **083 (S1)**: роль только из `raw_app_meta_data`, из user metadata — `client/owner` + `pending_approval`. Тесты: `security-hardening.test.ts` S1. **Владелец**: применить 083; проверить настройку signup (B2); `select … from profiles where role not in ('client','owner')` и сверить каждую запись с выдачей |

## 2. P1

| ID | Риск | Доказательство | Статус |
|---|---|---|---|
| P1-1 | Клиент меняет свои `tier`, `feature_flags`, `approved_*`, `telegram_*` → обход оплаты (при `access_gates`), спам в чужой чат | `001:280-286`, `048:11-15`, `045:11-12`; чтение прав через сессию `lib/access/server.ts:33` | **083 (S2)** guard-триггер |
| P1-2 | 25 Prisma-таблиц без RLS: `users.passwordHash`, токены NextAuth и CRM, share-токены, лиды, платежи | grep миграций и `init-schema.sql` (SEC-03) | **083 (S3)** RLS + REVOKE. [verify live] фактические гранты anon |
| P1-3 | `v_pending_users`, `v_client_diagnostics` обходят RLS (email, телефоны, баллы) | `001:490-535` | **083 (S4)** `security_invoker` + REVOKE |
| P1-4 | MFA только для страниц; флаги MFA в `user_metadata`, которую пользователь может менять | `verifyStepUp` без вызовов; `lib/mfa/store.ts:38-45`; `middleware.ts:315-316,352-353,404-405` | ✅ `f3e68f0`: step-up обязателен для API персонала (`requireGiga`, legacy-guard); флаги в `app_metadata` (`092`), пользователь не может их снять |
| P1-5 | SSRF с отражением 200 байт ответа: Bitrix24 принимает полный URL, amoCRM — произвольный домен | `lib/crm/bitrix24.ts:24-33,52`, `lib/crm/amocrm.ts:21-23`, `app/api/v1/crm/connections/route.ts:42-66` (+ `[id]/sync`) | ✅ `f4477e3`: allowlist доменов провайдера / явных хостов, только публичные IP и https, без эха ответа |
| P1-6 | Legacy `/api/v1/admin/*` вне GIGA RBAC: нет проверки статуса, ранга, MFA; admin может перевести super_admin в `pending_approval` и разблокировать заблокированных | `v1/admin/approve-user/route.ts:16-30`, `lib/users/approval.ts:46-61`, `lib/supabase-admin-guard.ts:16` | ✅ `c142994` + `f3e68f0`: статус, ранг, step-up |
| P1-7 | Бакет `documents` вероятно публичный (финансы, медицинские базы пациентов); `file_url`-guard не проверяет владельца объекта | `process/route.ts:67,122`, `FileUploadField.tsx:52`, `FileArea.tsx:178`, `onboarding/medical/route.ts:48`, `lib/upload-url.ts:29-36`; политик для `documents` в репо нет | 🟡 Новые загрузки — приватный `client-documents` (`089`), ссылки подписанные. Старые файлы и вложения анкеты — ⛔ B6 |
| P1-8 | Анонимная выдача одобренных аккаунтов `/api/auth/demo-access` (игнорирует `registration_mode`, кнопка на прод-логине); `demo-access/cleanup` удаляет любого demo-пользователя по UUID без auth; обещанного cron очистки нет | `demo-access/route.ts:72-127`, `cleanup/route.ts:19-59`, `login/page.tsx:52-58,206`, `vercel.json` | ✅ `a7c381b`: только при регистрации по приглашению и `DEMO_ACCESS_ENABLED`; маркер демо в `app_metadata` |
| P1-9 | Токены CRM в plaintext (SEC-06) | `046_crm_provider_connections.sql:16`; Prisma `crm_integrations.accessToken` | ✅ код (`f4477e3`): AES-256-GCM при заданном `SECRETS_ENCRYPTION_KEY`; старые токены — `scripts/encrypt-crm-tokens.ts --apply` (⛔ B7) |
| P1-10 | Клиент подделывает provenance: `metrics.source/confidence/provenance`, `documents.parsed_data/parse_status`, тип/автор инсайта, `gri_index`, `market_analysis_answers.status='confirmed'` | `023`, `020:18-34`, `024`, `021`, `028` (R5) | ✅ метрики (`088`, запись только сервером), документы (`089` guard `parsed_data`), выводы ИИ (`085` CHECK ревью). Инсайты/GRI/рынок — без изменений |
| P1-11 | Эксперт глобален: читает всех клиентов и **пишет** любые `action_items`, `point_b_versions`; список всех клиентов с email без пагинации | `030:36-40`, `031:31-35`, `app/api/expert/clients/route.ts:60`, `gri/baseline/route.ts:12-21` (R6) | **Владелец**: ограничивать ли экспертов назначением (`user_assignments` 082) / партнёром. D1 сохраняет экспертов в `is_platform_staff()` |
| P1-12 | Нет CI; нет тестов изоляции для новых таблиц | нет `.github/workflows` в корне | ✅ CI на каждый PR (`7ac4169`), DB/RLS-тесты новых таблиц |
| P1-13 | Тихие no-op: `diagnostics` без UPDATE-политики (ретайр `is_current`, сохранение narrative); staff-rebind/process документов через user-клиент → 0 строк и `ok:true` | `recalculate/route.ts:71-74`, `point-a/narrative/route.ts:111-133` (R8); `documents/[id]/rebind/route.ts:163-166` | ✅ записи пайплайна и rebind/process — через серверное соединение; нарратив/анализ — фаза 6 |
| P1-14 | Prompt injection в путях, которые станут инструментами агентов: нет обёртки в `extract-rows.ts` и `bind-fields-ai.ts`; report-chat кладёт чанки в system prompt с неэкранированным разделителем | `extract-rows.ts:532-540,572-579`, `bind-fields-ai.ts:175-187`, `report-chat/prompt.ts:84-90` | ✅ обёртка untrusted во всех путях с данными клиента (`extraction.ts`, `extract-rows`, `bind-fields-ai`, инсайты, financial-analyst, pulse, агенты); тесты `tests/unit/security/prompt-injection.test.ts` |

## 3. P2

| ID | Риск | Доказательство | Статус |
|---|---|---|---|
| P2-1 | NextAuth Google-хендлер смонтирован; `notifications/send` пускает любую NextAuth-сессию → письма/Telegram админам | `lib/auth.config.ts:13-18`, `notifications/send/route.ts:17,39` | **Phase 11** удалить NextAuth. [verify live] Google env |
| P2-2 | Telegram-вебхук: секрет опционален (fail-open), `!==`, нет дедупа `update_id`; код привязки клиента 48 бит, plaintext, без TTL | `app/api/telegram/webhook/route.ts:20-26,55-72`, `lib/telegram.ts:33`, `045` | ✅ `3518278`: секрет обязателен, constant-time, дедуп `update_id`; код привязки персонала — хэш + 15 мин |
| P2-3 | Секрет cron в query (`?secret=`), сравнение `===` | `cron/crm-digest/route.ts:106-109`, `telegram/personal/sync/route.ts:12` | ✅ `f15b06b`: только заголовок, constant-time |
| P2-4 | Break-glass: общий пароль, без MFA, cookie 7 дней, действия не атрибутируются; `/api/admin/overview` принимает его без проверки `break_glass_enabled` | `giga-admin/auth/route.ts:134-204`, `lib/giga-cookie-edge.ts:18`, `admin/overview/route.ts:21` | **Владелец**: держать `break_glass_enabled=false`. **Phase 11** удалить `/api/admin/*` |
| P2-5 | Статус пользователя не проверяется в `requireExpert`, `requireSupabaseAdmin`, `api-identity`; middleware не гейтит `/api` (статус, MFA, техработы) | `middleware.ts:160-216`, `lib/expert-auth.ts:47-60` | ✅ статус и step-up в `requireGiga`/legacy-guard; middleware по-прежнему не гейтит `/api` — проверки в обработчиках |
| P2-6 | 44 файла возвращают `error.message`; заголовок `x-user-role`; 22 файла падают на anon-ключ; нет `server-only` | `lib/api-error.ts` в 8 файлах; `middleware.ts:266`; `lib/supabase-admin-guard.ts:37`, `lib/expert-auth.ts:14` | ✅ `f3e68f0`: клиентские ответы без текстов ошибок БД (`dbError`/`safeErrorMessage`), fallback на anon-ключ убран (fail closed) |
| P2-7 | In-memory rate limit без вытеснения, per-instance | `lib/rate-limit.ts:40,51-60` | **Владелец**: Upstash в проде. **Phase 11** обязательность |
| P2-8 | Internal-токен не привязан к эндпоинту/пользователю; origin из Host | `lib/internal-auth.ts:33-60`, `recalculate/route.ts:105-118` | **Phase 11** (на Vercel безопасно) |
| P2-9 | Impersonation: удаление cookie `aistart360_imp` даёт неаудируемую сессию цели; scope `signOut` при выходе не проверен | `middleware.ts:30-57`, `impersonation/route.ts:168-196`, `exit/route.ts:20` | **Владелец** (ограничение дизайна); verify scope |
| P2-10 | Публичный `/api/health`: выдуманный uptime, имена отсутствующих env; `public/mini-gri` шлёт письмо на любой адрес | `app/api/health/route.ts:21,53-54,72-93` | ✅ `f15b06b`: только измеренное, без имён env |
| P2-11 | CSP `'unsafe-inline'`; пароль ≥6 на сервере при 8 в UI; `email_confirm:true`; store fail-open в `approved` (SEC-10/11) | `next.config.mjs:59-68`, `auth/register/route.ts:14,66`, `stores/auth.store.ts:120-122` | **Phase 11** |
| P2-12 | `/api/reports/[id]`: любой staff читает/удаляет отчёт любого клиента; server action `uploadReport` без auth, uploader из cookie, запись на диск | `app/api/reports/[id]/route.ts:6,23-28`, `app/actions/reports.ts:67-126` | **Phase 6/13** |
| P2-13 | Signed URL на 1 год хранится в `documents.file_url`; удаление оставляет объекты (`/object/sign/`) и summary/chunks | `onboarding/documents/page.tsx:458`, `documents/[id]/route.ts:41-47` | **Phase 5** |
| P2-14 | `point_b_versions_owner_read` без фильтра `is_approved` — клиент видит черновики эксперта | `031:22-28` (R7) | **Phase 2** |
| P2-15 | Фильтр-инъекция `documentId` в PostgREST-запрос (смягчено пост-проверкой); `?user_id=` без auth в сиротском `/api/v1/point-a/benchmarks`; нормализация пути market-прокси | `medical/audit/run/route.ts:88-89`; `point-a/benchmarks/route.ts:120,139-150`; `app/api/market/[...path]/route.ts:53-58,86` | **Phase 4** (удалить сироту), **Phase 9–13** |
| P2-16 | Preview-деплой открывает анонимный Journey (LLM) | `middleware.ts:60-63`, `lib/journey/http.ts:33-37` | **Владелец**: ключи preview ≠ прод |
| P2-17 | `TELEGRAM_USER_SESSION` в env = захват личного аккаунта при утечке | `lib/telegram/personal-client.ts:11-13` | **Владелец**: оставлять ли userbot |
| P2-18 | `search_path` не закреплён у 4 триггер-функций; bare `auth.uid()` в политиках | 01-аудит R15 | `set_updated_at` — **083**; остальные — **Phase 2** |
| P2-19 | `prisma/seed.ts` удаляет данные без проверки окружения | `prisma/seed.ts:9-13` (R16) | **Phase 11** |
| P2-20 | Гигиена миграций: дубли номеров, нет Prisma-миграций, `assertServerEnv` без вызовов, 5 env не задокументированы | 01 §1.2, 05 §8 | 🟡 `.env.example` дополнен; `assertServerEnv` сознательно не роняет сервер (видно в health); нумерация миграций 083–093 без дублей |
| P2-21 | Фейковые данные на прод-поверхностях | [02 §2.3](02-gap-analysis.md) | **Phase 3, 13** |

Сильные места (не трогать, использовать как шаблон): вебхуки Meta / WhatsApp-bridge / Kaspi / MyHonor (HMAC по сырым байтам, `timingSafeEqual`, fail-closed 503, nonce/timestamp, ротация ключей); `requireGiga` на всех 71 маршрутах GIGA с CSRF-проверкой Origin и рангами; append-only `admin_audit_log`; все `SECURITY DEFINER`-функции с `search_path`; TOTP-секреты в AES-256-GCM; заголовки безопасности (`next.config.mjs:84-116`).

## 4. Prompt injection

| Состояние | Где |
|---|---|
| Защищено | `lib/documents/extract.ts:253-283` (правило «untrusted», `<untrusted_document>`, экранирование тегов); `lib/journey/prompt.ts:11,51-60`; omnichannel: детектор (`lib/omnichannel/guardrails.ts:53-55`), `sanitizeUntrusted`, политика «черновик или эскалация»; валидатор вывода блокирует `prompt_injection`/`data_leakage` (`lib/ai/validation/index.ts:65`); RAG-RPC скоупится на сервере |
| Пробелы | `extract-rows.ts` и `bind-fields-ai.ts` без обёртки; report-chat — чанки в system prompt; `financial-analyst` и `pulse` интерполируют текст файлов/CRM; извлечённые числа пишутся в БД без проверки границ |
| Цель | Правила [05 §6](05-agents.md): untrusted-обёртки везде, фиксированный набор инструментов, zod + границы чисел, SEND_*/DELETE/MODIFY только через одобрение, проверка ссылок `evidence`, детектор инъекций, редакция логов |
| Тест | Корпус «вредных» документов (инструкции «игнорируй правила», поддельные закрывающие теги, просьбы отправить email/удалить данные) → ожидание: набор инструментов не меняется, SEND_* не вызывается, извлечённые значения проходят валидацию или помечаются |

## 5. План тестов изоляции тенантов

Инструменты: `scripts/test-db/setup.mjs` (локальное зеркало прода) + `tests/helpers/pg-rls.ts` (`SET ROLE anon/authenticated` + `request.jwt.claims`, транзакция с откатом). Запуск при `TEST_DATABASE_URL`; в CI — обязательно (Phase 11, частично Phase 2).

Фикстуры: компании A и B (прямые), компания C у партнёра P; пользователи: owner/member/viewer A, owner B, partner_admin P, partner_expert P, staff (admin, analyst, expert), anon; service role.

| Актор \ ресурс | Строки A | Строки B | Строки C | Новые таблицы (запись) |
|---|---|---|---|---|
| anon | ✗ | ✗ | ✗ | ✗ |
| owner A | R/W (как сейчас по `user_id`) | ✗ | ✗ | ✗ (только service role) |
| member / viewer A | R | ✗ | ✗ | ✗ |
| owner B | ✗ | R/W | ✗ | ✗ |
| partner_admin P | ✗ | ✗ | R | ✗ |
| partner_expert P | ✗ | ✗ | R | ✗ |
| staff | R | R | R | ✗ (через API + service role) |

| Уровень | Что проверяем |
|---|---|
| SQL / RLS | SELECT/INSERT/UPDATE/DELETE по матрице для `companies`, `survey_answers`, `documents`, `metrics`, `diagnostics`, `gri_assessments`, `company_members`, `partner_*`, всех таблиц 085–088; AI_HYPOTHESIS не видна клиенту; `report_versions` — только `published`; guard-триггеры отклоняют подделку provenance |
| Функции | `can_read_company` / `can_manage_company` для каждого актора; `SECURITY DEFINER` + закреплённый `search_path`; EXECUTE отозван у anon там, где нужно |
| API | Маршруты клиента с чужим `company_id`/`document_id` в теле или URL → 403/404; `file_url` чужого объекта отклоняется; route-permission тесты GIGA для новых прав |
| Агенты | Инструмент с подставленным `company_id` в аргументах работает только с `company_id` задачи; задача компании A не читает файлы B; бюджет компании A не тратится задачами B |
| Хранилище | Путь вне папки вызывающего → отказ finalize; signed URL не выдаётся для чужого объекта |
| Регресс | Повторное применение всех миграций идемпотентно (кроме задокументированных 001/004/009/010); `schema_migrations` фиксирует каждый файл |
