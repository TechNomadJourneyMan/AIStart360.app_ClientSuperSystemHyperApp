# 04 · Роли, права, безопасность, масштабирование, интеграции

> Product discovery 2026-09-23. Аудит по коду (272 маршрута `app/api/**` просмотрено эвристикой, около 70 прочитано вручную). К БД и серверам не подключались, значения секретов не выводились. Состояние прода (настройки Auth, применённые миграции, env) проверить не удалось, такие пункты помечены UNCLEAR.
> Идеи здесь черновые; сводный backlog с ID — в [00-summary.md](00-summary.md).

## Главное

1. **🔴 Critical — S1.** Любой может зарегистрироваться сразу как `super_admin` напрямую через Supabase Auth: триггер `handle_new_user` берёт роль из присланных метаданных и одобряет не-клиентов. **Подтверждено по коду** (`supabase/migrations/002_fix_user_trigger_status.sql:13-20`). Состояние на проде — UNCLEAR.
2. **High — S4.** 2FA для персонала проверяется только на страницах. `/api/giga-admin/*` работает с одной парольной сессией.
3. **High — S2.** `profiles.role='admin'` может сделать себя `super_admin` через RLS `profiles_admin_update`.
4. **High — S5.** Режим «просмотр от имени» ограничивает только `/api/*`. Прямые запросы браузера к Supabase не ограничены, а в режиме правки нет запрета менять пароль, email и 2FA.
5. **High — S7.** Prisma-таблицы и таблицы из 033 без RLS и REVOKE (SEC-03 открыт).

## 1. Карта ролей

Три независимые системы:
- **`profiles.role`** (`super_admin, admin, manager, analyst, client, expert, owner`) — выбор кабинета в middleware и RLS через `current_user_role()`;
- **`staff_roles.role`** (`super_admin, admin, super_expert, crm_manager, content_manager, analyst, support`) — права в GIGA-CRM (`lib/admin/rbac.ts`);
- **Prisma `UserRole`** + `lib/rbac.ts` — устаревшие `/api/admin/*`.

Таблицы `user_role_assignments` нет. `user_assignments` (082) — это «ответственный», а не роль.

| Роль | Видит | Создаёт | Редактирует | Удаляет | Назначает | Данные | Запрещено |
|---|---|---|---|---|---|---|---|
| **super_admin** | всё в GIGA, аудит, настройки | приглашения, контент, задачи | всё | архив, **purge**, анкеты, GRI | любую staff-роль | полный PII, экспорт до 5000 | удалить себя или другого super_admin; имперсонировать персонал |
| **admin** (staff) | всё, кроме ролей и системных настроек | то же | пользователи, анкеты, GRI, контент | архив, анкеты, GRI | — | полный PII | `roles.manage`, `settings.manage`, `users.delete` |
| **admin** (profiles) | `/dashboard`, `/api/admin/*`, `/api/v1/admin/*`; через RLS — все профили | клиентов (маршрут сломан) | **любой профиль через PostgREST, включая `role`** | — | фактически себе `super_admin` | всё через RLS | в GIGA без `staff_roles` не попадает |
| **super_expert** | пользователи, анкета, GRI, CJM, аналитика, inbox (чтение) | приглашения | компания, анкета; имперсонация с правкой (отключается) | — | — | полный PII | настройки, роли, блок, 2FA, архив, удаление, правка GRI, аудит |
| **crm_manager** | как super_expert + inbox и leads | приглашения | блок, тариф, **сброс 2FA**, анкета, GRI, лиды | — | — | полный PII | удаление, архив, аудит, контент, роли |
| **content_manager** | контент, секции, модерация инсайтов | страницы и медиа | публикация, секции | контент | — | без PII | всё про пользователей |
| **analyst** (staff) | пользователи (маскированно), анкеты, GRI, активность, CJM | — | — | — | — | маскированные контакты, но `survey.view` без `users.sensitive` | PII, правка |
| **support** | пользователи с PII, анкеты, GRI, inbox (чтение) | — | — | — | — | полный PII | правки; имперсонация только просмотр |
| **expert** (profiles) | `/expert/*`: **любой клиент** | комментарии, кейсы | GRI-заметки любого `user_id` | свои комментарии | — | все клиенты через RLS | ADMIN_PATHS |
| **manager / analyst** (profiles) | в middleware приравнены к expert | — | — | — | — | RLS-чтение многих таблиц | назначаются только в БД |
| **owner** (profiles) | `/owner/*`; **доступен при самостоятельной регистрации** | своё | своё | — | — | своё через RLS | ADMIN_PATHS, EXPERT_PATHS |
| **client** | свой кабинет | анкета, документы, CRM | **свои `tier` и `feature_flags` через PostgREST** | своё | — | RLS own | всё staff |

**Проблемы модели:** две системы ролей для персонала, причём RLS смотрит только на `profiles.role`. `admin` и `analyst` есть в обеих с разным смыслом. Три пути одобрения заявок. Эксперт не привязан к клиентам. Нет step-up для purge, выдачи super_admin, сброса 2FA и имперсонации с правкой.

## 2. Проблемы прав и безопасности

| # | Находка | Серьёзность | Доказательство | Рекомендация |
|---|---|---|---|---|
| **S1** | **Регистрация сразу в super_admin.** `POST {SUPABASE_URL}/auth/v1/signup` с anon-ключом и `data:{role:'super_admin'}` создаёт одобренного super_admin, а `getGigaActor` признаёт его по `profiles.role`. Ограничение `z.enum(['client','owner'])` в `/api/auth/register` это не закрывает | **Critical** (UNCLEAR: включена ли в проде публичная регистрация Supabase Auth) | `002_fix_user_trigger_status.sql:13-20`; `giga-actor.ts:54-55` | Миграция: `handle_new_user` всегда пишет `client` + `pending_approval`. Ревизия прода: `SELECT id,email,role,status FROM profiles WHERE role<>'client'` |
| S2 | Admin делает себя super_admin: `profiles_admin_update` без `WITH CHECK` разрешает менять любые колонки, включая `role` | High | `006_fix_rls_recursion.sql:28-31` | Column-level REVOKE или триггер-guard; писать только service-role маршрутами с аудитом |
| S3 | Клиент сам повышает себе тариф: `profiles_update_own` защищает только `role`/`status`, а `tier` и `feature_flags` (048) не защищены | High (при включённых гейтах) | `001:280-285`, `048:12-15` | Тот же guard |
| S4 | MFA не проверяется в API: middleware не трогает `/api/*`, `requireGiga` не проверяет step-up cookie | High | `middleware.ts:167`, `giga-actor.ts` | Проверять MFA-cookie в `requireGiga`; свежий step-up для purge, ролей, 2FA и имперсонации |
| S5 | Режим просмотра обходится: выдаётся настоящая сессия цели, cookies читаются из JS, ограничения работают только для `/api/*`; в режиме правки нет запрета на смену пароля, email и 2FA | High | `impersonation/route.ts:168-190`, `middleware.ts` `guardImpersonatedApi`, `lib/impersonation/token.ts:46-49` | Отзыв сессии на сервере, denylist, в перспективе read-only прокси |
| S6 | Сессия цели переживает конец имперсонации; `v1/impersonation/exit` делает global `signOut()` и выкидывает клиента со всех устройств | Medium | `impersonation/[id]/end/route.ts`, `v1/impersonation/exit/route.ts:20` | `signOut({scope:'local'})` + отзыв конкретного refresh-токена |
| S7 | Prisma-таблицы и `mini_gri_leads`, `shared_reports`, `subscriptions`, `payment_transactions` без RLS и REVOKE (в т.ч. OAuth-токены, открытый `accessToken`) | High (UNCLEAR, если закрыто на проде вручную) | `033_app_share_payments_leads.sql`, `prisma/schema.prisma` | `REVOKE ALL FROM anon, authenticated` + `ENABLE RLS` одной миграцией |
| S8 | NextAuth + Google всё ещё работает; сессия без `orgId` → `/api/clients` с `where:{orgId:undefined}` отдаёт **всех клиентов** | Medium (UNCLEAR: зарегистрирован ли callback в Google Console) | `api/auth/[...nextauth]/route.ts`, `lib/auth.config.ts:13-18`, `api/clients/route.ts:16-19` | Удалить NextAuth и маршруты на `lib/api-utils` |
| S9 | ~~Старый break-glass cookie принимается в `/api/admin/overview`~~ | Medium | — | **ИСПРАВЛЕНО 2026-09-23** в этой ветке. Рекомендуется также сменить `GIGA_COOKIE_SECRET` |
| S10 | Мёртвая `isPrivilegedViewer` пропускает неподписанный cookie со значением `'super_admin'` | Low (вызовов нет) | `lib/expert-auth.ts:68` | Удалить |
| S11 | Вход владельца: один фактор, лимит на IP в памяти инстанса без Upstash, email по умолчанию захардкожен | Medium | `giga-admin/auth/route.ts`, `owner-password.ts:16`, `rate-limit.ts` | Глобальный счётчик неудач, Upstash, 2FA после пароля |
| S12 | Нет аудита у `requests` POST, `leads/[id]`, `tasks/[taskId]`, `market-analysis` и **экспорта CSV с PII** | Medium | `users/export/route.ts:41-80` и др. | `recordAdminAction` везде |
| S13 | Purge не покрывает Prisma-таблицы, `mini_gri_leads`, omnichannel-контакты, Google Sheets, Langfuse, Resend; нет step-up; ошибки удаления файлов только в `console` | Medium | `purge/route.ts`, `083` | Реестр PII, step-up, `filesFailed` в аудит |
| S14 | `requireSupabaseAdmin` не проверяет `status`, есть fallback на anon-ключ | Medium | `supabase-admin-guard.ts:37-52` | Проверять `approved`; без service key — отказ |
| S15 | `/api/v1/admin/clients` создаёт пользователя через anon-клиент, пароль задаёт админ, аудита нет | Low | `v1/admin/clients/route.ts:15,22` | Удалить или переписать |
| S16 | Middleware пускает в `/admin-giga-panel` по любой строке `staff_roles` без проверки статуса (API статус проверяет) | Low | `middleware.ts:333` | Проверять статус |
| S17 | Эксперт видит любого клиента | Medium | `lib/expert-auth.ts:9,47-59` | Привязка через `user_assignments` |
| S18 | Нет лимитов на AI и тяжёлые маршруты: `/api/pulse`, `market-analysis`, `export/report`, `v1/assistant/*`, `quality` | Medium | `pulse/route.ts:373-387` | Лимиты и кэш |
| S19 | Секрет cron принимается в `?secret=` (попадает в логи), сравнение не константное по времени | Low | `cron/crm-digest/route.ts:107-108` | Только заголовок + `timingSafeEqual` |
| S20 | Публичный `/api/health` раскрывает имена отсутствующих env и выдуманный uptime «99.8%» | Low | `api/health/route.ts:21,73-76` | Только ok/fail |
| S21 | Нет Origin-проверки на мутациях `v1/*` и `/api/admin/*` (есть только SameSite=Lax) | Low | — | Общий helper |
| S22 | Один секрет подписывает staff-, imp-, MFA- и внутренние токены | Low | `signed-token.ts:27` | HKDF по назначению |
| S23 | CRM-токены хранятся открытым текстом (SEC-06 открыт) | Medium | `046_*.sql:16`, `v1/crm/connections/route.ts:75` | `encryptSecret` |
| S24 | `/api/auth/demo-access` создаёт одобренные аккаунты, лимит 5/мин на IP в памяти | Low | `demo-access/route.ts:50` | Капча, глобальный лимит |

**Проверено, в порядке:** `requireGiga` с правами стоит на всех 70+ маршрутах giga-admin. `forbidTarget` есть на опасных маршрутах. Webhook-и Meta и WhatsApp проверяют HMAC. Kaspi проверяет HMAC, но имя заголовка помечено «сверить». `client/register` исправлен. Purge пишет компенсирующую запись `user.purge_failed` (`purge/route.ts`).

## 3. RLS и данные

- В миграциях 75 `CREATE TABLE` и 67 `ENABLE RLS`. Без RLS: 4 таблицы из 033 и все Prisma-таблицы. 27 таблиц закрыты только для service-role (RLS без политик + REVOKE) — это правильно.
- **RLS держится на `profiles.role` без проверки статуса.** Заблокированный admin или expert с живым JWT читает данные напрямую. Вместе с S1 это прямая утечка всех клиентов.
- **`profiles_status_check`:** миграция `059_admin_actor_and_block_status.sql:31-43` добавляет `blocked`/`archived`. Если на проде 4 статуса, 059 не применена: блокировка и архивация в GIGA не работают, а GoTrue-бан не ставится.
- `handle_new_user` последний раз определяется в 002 — корень S1.
- Дублирование Prisma и Supabase: `audit_logs` / `admin_audit_log`, `users` / `profiles`, `crm_integrations` / `crm_provider_connections`, `notifications`, блокировка через Prisma `user.status`.
- `admin_audit_log` неизменяем, связи по FK нет, поэтому записи переживают purge. Это хорошо.

## 4. Масштабирование ×10

| Что сломается | Почему | Что предусмотреть |
|---|---|---|
| Счётчики `/api/admin/overview` | тянет все строки через PostgREST (`max_rows` по умолчанию 1000), цифры тихо обрезаются | `count: 'exact', head: true` или RPC |
| Список и экспорт GIGA | `admin_list_users` каждый раз агрегирует всю `survey_answers`/`gri_assessments`; ILIKE по 5 полям | материализованная `user_summary`, `pg_trgm` |
| `GET /api/pulse` | без limit + синхронный OpenRouter на каждый запрос | пагинация, кэш брифинга на сутки, лимиты |
| Cron `crm-digest` | одна функция, `maxDuration=60`, письма по 25 параллельно | fan-out через Inngest, batch API Resend |
| Middleware | 2–4 сетевых запроса на каждую страницу | роль и статус в JWT custom claims |
| Rate-limit | без Upstash в памяти инстанса; `memBuckets` растёт без очистки | Upstash обязателен в проде (UNCLEAR, настроен ли) |
| Кэши настроек и имперсонации | в памяти, закрытая сессия живёт до TTL на каждом инстансе | запрос без кэша при закрытии |
| `user_events` | до 240/мин на пользователя, 4 индекса, очистка вручную | партиции по месяцу + cron-удаление |
| Storage | без lifecycle и квот | квоты, сверка «файлы без владельца» |
| AI в пути запроса | диагностика, стратегия, market-analysis, PDF — синхронно | Inngest со статусом |
| Экспорт CSV | 5000 строк синхронно в памяти | стрим или фоновая задача |
| Cron в `vercel.json` | всего 2 задачи | перенести в Inngest cron |

## 5. Интеграции

| Интеграция | Статус | Факт |
|---|---|---|
| Telegram-бот | EXISTING / IMPROVEMENT | webhook с секретом; token, username и setWebhook, по памяти проекта, не настроены |
| Telegram personal sync | EXISTING | cron 05:00; секрет в query (S19) |
| WhatsApp Cloud API | EXISTING (UNCLEAR на проде) | webhook Meta с HMAC |
| WhatsApp Web bridge | EXISTING | HMAC с ротацией |
| Instagram | EXISTING | webhook Meta, backfill, omnichannel inbox |
| Resend | EXISTING / IMPROVEMENT | retry, `email_deliveries`; нет batch и webhook bounce/complaint |
| OpenRouter | EXISTING | нет общего бюджета |
| n8n | **MISSING** | `N8N_WEBHOOK_URL` только в `.env.example`, в коде 0 ссылок |
| Google Sheets | EXISTING (нужны env) | Apps Script webhook |
| Mark-analytics | EXISTING | прокси `app/api/market/[...path]` + MCP; облачный деплой не сделан |
| Платежи, Kaspi | заглушка (намеренно) / UNCLEAR | `/api/checkout` stub; имя заголовка Kaspi «сверить» |
| Bitrix24 / amoCRM | IMPROVEMENT | новый путь хранит токен открытым текстом |
| MyHonor | EXISTING | order-notifications |
| Inngest | EXISTING | 7 функций; `INNGEST_SIGNING_KEY` на проде — UNCLEAR |
| Langfuse | IMPROVEMENT | используется только в `actions/diagnostics.ts` |
| Внешняя аналитика (PostHog, GA) | MISSING | — |
| Исходящие webhook-и и публичный API | MISSING | — |

## 6. Идеи (черновые, S-1…S-15)

| # | Idea | Problem | Solution | Cx | Impact | Dependencies | Existing? |
|---|---|---|---|---|---|---|---|
| S-1 | Жёсткий `handle_new_user` | S1 | всегда `client`/`pending` + ревизия текущих не-клиентов | S | **Critical** | доступ к проду | Нет |
| S-2 | Guard-триггер на `profiles` | S2, S3 | `role, status, tier, feature_flags` меняет только service_role | S | High | S-1 | Частично |
| S-3 | MFA в `requireGiga` + step-up | S4 | MFA-cookie + свежий step-up для критичных действий | M | High | `lib/mfa/step-up` | Частично |
| S-4 | Безопасная имперсонация | S5, S6 | отзыв сессии, denylist, read-only прокси | M–L | High | Supabase admin API | Частично |
| S-5 | REVOKE + RLS на Prisma-таблицах | S7 | одна миграция + тест anon=401 | S | High | решение о внешних читателях | Нет |
| S-6 | Удалить устаревший стек | S8–S10, S15 | NextAuth, `/api/admin/*`, `lib/rbac.ts`, `giga-cookie` | M | Medium | проверка UI | Нет |
| S-7 | Одна модель ролей | две системы | RLS через `staff_roles` (`is_staff(perm)`) | L | High | S-2, S-6 | Частично |
| S-8 | Привязка эксперта | S17 | `user_assignments` в `requireExpert` и RLS | M | Medium | S-7 | таблица есть |
| S-9 | Аудит 100% мутаций и экспорта | S12 | обёртка `withAudit` + отчёт о покрытии в CI | S | Medium | — | Частично |
| S-10 | Реестр PII и полное удаление | S13 | карта хранилищ + задача Inngest по внешним системам | M | Medium | инвентаризация | Частично |
| S-11 | Upstash обязателен + бюджет AI | S18 | проверка при старте, `ai_usage`, лимиты | S–M | High | Upstash | Частично |
| S-12 | `user_summary` + триграммы | §4 | материализованная сводка | M | High | — | Нет |
| S-13 | Фоновые задачи | cron и AI в запросе | Inngest fan-out | M | High | Inngest | Частично |
| S-14 | Retention и партиции событий | рост `user_events` | партиции + cron | M | Medium | — | ручная очистка |
| S-15 | Исходящие webhook-и и n8n | нет выхода интеграций | `event_subscriptions` + подпись | M | Medium | S-9 | Нет |

## 7. Вопросы к владельцу

1. Включена ли на проде публичная регистрация Supabase Auth? Можно ли прямо сейчас проверить `profiles` на роли, отличные от `client` (S1)?
2. Применена ли миграция 059 на проде?
3. Нужна ли роль `owner` в самостоятельной регистрации? Что она означает?
4. Сохраняем `profiles.role` admin/expert/manager/analyst или переносим всё в `staff_roles`?
5. Режим «просмотр от имени»: честный read-only или допустима настоящая сессия? Можно ли в режиме правки менять пароль, email и 2FA клиента?
6. Делаем 2FA обязательной для персонала и step-up для критичных действий?
7. Читает ли что-то внешнее Prisma-таблицы по anon-ключу? Можно ли сделать REVOKE?
8. Можно ли удалить NextAuth, `/api/admin/*`, `/api/clients`, `/api/notifications*`?
9. Настроен ли Upstash в Vercel prod? Нужен ли дневной бюджет на AI?
10. Эксперт видит только назначенных клиентов?
11. Что входит в «полное удаление»? Какой срок хранения событий?
12. Нужны ли n8n и исходящие webhook-и?
13. Kaspi: точное имя заголовка подписи? Когда уходим с заглушки?
14. Ограничивать ли экспорт CSV (роль, аудит, водяной знак)?
