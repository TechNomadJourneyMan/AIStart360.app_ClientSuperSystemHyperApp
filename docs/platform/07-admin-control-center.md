# 07 — Admin Control Center (GIGA-CRM)

Назначение: карта админ-поверхностей сегодня, что выводится из эксплуатации, и новый раздел «ИИ-агенты» с правами и Telegram-одобрениями (D4, D8).
Обновлено: 2026-10-06

Связанные: [05-agents.md](05-agents.md), [03-database.md](03-database.md) (086, 087), [09-security.md](09-security.md).

## 1. GIGA-CRM сегодня (канонический)

Шелл: `app/admin-giga-panel/layout.tsx` → `WorkspaceShell` («GIGA-CRM», «Platform Control Center», `components/giga-panel/WorkspaceContext.tsx:29`). Навигация: `lib/admin/nav.ts:9-42`, пункты скрываются без права. API: `/api/giga-admin/**` (71 маршрут; все, кроме `auth`, через `requireGiga` / `authorizeUserDataRead`). RBAC: 32 права (`lib/admin/rbac.ts:23-56`), 7 ролей (`:69-105`).

| Группа | Страница | Маршрут | Право | Что показывает / делает |
|---|---|---|---|---|
| Обзор | Главная («Центр управления») | `/admin-giga-panel` | `dashboard.view` | CJM-воронка, GRI, безопасность, регистрации/активность по дням, последние события и действия персонала |
| Пользователи | Пользователи | `/users`, `/users/[id]` | `users.view` | User 360: профиль, анкета, GRI, активность, Journey, документы, письма, заметки, задачи, история, качество |
| | Заявки | `/requests` | `users.view` | Заявки на доступ (`admin_requests` → `applyApprovalDecision`) |
| | Приглашения | `/invites` | `users.view` | `platform_invitations` |
| | Клиенты | `/clients` | `users.view` | AccountsPage → ClientsModule |
| | Дубликаты | `/duplicates` | `users.sensitive` | Поиск дублей |
| | Лиды | `/leads` | `leads.view` | mini-GRI и др. лиды |
| Данные | Анкеты / GRI / Активность / CJM | `/surveys`, `/gri`, `/activity`, `/cjm` | `survey.view`, `gri.view`, `activity.view`, `cjm.view` | Сводки и детали |
| Коммуникации | Instagram / WhatsApp | `/inbox` | `inbox.view` | Omnichannel + настройки AI-ответчика (`omnichannel_settings`: mode off/draft/auto, порог уверенности, задержка) |
| | Инсайты рынка | `/market` | `market.manage` | Рыночные инсайты |
| | Модерация ИИ | `/moderation` | `insights.moderate` | Публикация/отклонение AI-инсайтов |
| Платформа | Контент / Разделы / Настройки | `/content`, `/sections`, `/settings` | `content.view`, `platform.sections`, `users.manage` | CMS, видимость разделов, настройки (регистрация, AI, техработы, безопасность, ретенция, тумблеры админ-уведомлений, HealthCard) |
| Безопасность | Роли и права / Вход от имени / Журнал аудита | `/staff`, `/impersonation`, `/audit` | `dashboard.view`, `impersonate.view`, `audit.view` | `staff_roles`, сессии impersonation, `admin_audit_log` |

`/super-expert/**` — тот же код (`components/giga-panel/pages/*`) с урезанной навигацией (`lib/admin/nav.ts:54-72`); не отдельная реализация.

Слабые места GIGA сегодня: MFA step-up проверяется только для страниц, не для API (`verifyStepUp` без вызовов); ~~break-glass-действия не атрибутируются человеку (`giga:super_admin`)~~ — вход по общему паролю удалён (W1); мёртвый `GigaAccessGuard.tsx` — удаляется в W1.

**Вход в панель (с W1, миграция 099).** Только личный аккаунт сотрудника: `/login` (email+пароль, ссылка на почту или Google в Supabase Auth) → второй фактор `/2fa` → `/admin-giga-panel`. Страница `/giga-login` лишь ведёт на `/login?from=/admin-giga-panel`; `/login` теперь соблюдает безопасный `?from=` и для известной роли (`lib/role-landing.ts` `postLoginPath`). Сотрудник, у которого роль только в `staff_roles` (profiles.role = 'client'), приземляется в своей панели (SuperExpert — в `/super-expert`), а не в клиентском кабинете. Миграция **099** делает `technomadjourneyman@gmail.com` super_admin (profiles + `staff_roles`), перечисляет прочих super_admin без понижения и перечисляет одобренные профили с legacy-ролью `admin` без `staff_roles` — доступа они **не** получают (решение владельца: пока в панель входит только он; выдать — GIGA → «Сотрудники»). Выход — `DELETE /api/giga-admin/auth` (чистит staff-cookie) + `signOut`. Для E2E — тестовый шов `lib/admin/e2e-auth-seam-edge.ts` (сид super_admin + cookie с HMAC под `E2E_AUTH_SEAM_SECRET`; в production-сборке код-путь мёртв).

**Роль `owner`** (бывшая вкладка «Команда AIStart360» на регистрации) — legacy: приложение обращается с ней как с клиентом (middleware, навигация, лендинг, `/api/pulse` больше не отдаёт все сделки и всех клиентов). Регистрация создаёт только клиентов; триггер `handle_new_user` (099) больше не выдаёт `owner`. Сколько таких профилей осталось — NOTICE миграции 099 или `SELECT count(*) FROM public.profiles WHERE role = 'owner';`.

## 2. Legacy-поверхности (вывести)

| Поверхность | Маршруты | Почему | Замена | Фаза |
|---|---|---|---|---|
| Legacy «/admin» | `/admin`, `/admin/requests` | Prisma-эпоха; другие guard-ы; дублирует GIGA | ✅ W1: удалено, middleware ведёт `/admin*` → GIGA (персонал) | — |
| `/api/admin/*` (16) | overview, requests, audit, users… | `lib/rbac.ts` (expert→MANAGER открывает API экспертам); `overview` принимал break-glass | ✅ W1: удалено → `/api/giga-admin/*` | — |
| `/api/v1/admin/*` (5) | approve-user, users/[id]/approve\|reject, pending-users, clients | Нет проверки статуса/ранга/MFA: admin блокирует super_admin; `clients` вызывает `auth.admin.createUser` на anon-клиенте (всегда падает) | GIGA `requests` (`users.approve` + `forbidTarget`) | 2 (закрыть), 13 (удалить) |
| `/owner/**` | 19 страниц, 15 — реэкспорты | `/owner/admin` сломан по дизайну (owner → CLIENT) | ✅ W1: удалено вместе с `OwnerSidebar/OwnerHeader`; owner = клиент | — |
| `(dashboard)/users`, `/team` | — | localStorage-мок; Prisma `user` | ✅ W1: `/users` удалено (+ `shared/api/{users,auth}.service.ts`) → GIGA `/admin-giga-panel/users`; `/team` — позже | 13 |
| `(dashboard)/intelligence`, `/reports`, `/analytics` | — | Константы, заглушки, фильтры без обработчиков | GIGA «ИИ-агенты» / отчёты | 13 |
| `/api/notifications*` + Prisma `notifications` | — | NextAuth-only, недостижимо; `send` — латентный спам-вектор | ✅ W1: маршруты удалены (таблица остаётся) | — |
| `app/actions/auth.ts`, `app/actions/reports.ts` | — | Нет вызовов; запись на диск Vercel, cookie-атрибуция | ✅ W1: `auth.ts` и `diagnostics.ts` удалены; `reports.ts` остаётся | 13 |

## 3. Новый раздел «ИИ-агенты»

Размещение: группа `GIGA_NAV` между «Коммуникации» и «Платформа»; иконка в `ICONS` (`components/giga-panel/GigaSidebar.tsx:19-24`); страницы `app/admin-giga-panel/agents/**` на `components/giga-panel/kit` (`PageHeader`, `Panel`, `useGigaQuery`, `gigaFetch`) и `RequirePermission`; API `app/api/giga-admin/agents/**`. Все мутации — `requireGiga(perm)` + `recordAdminAction`. Название «ИИ-агенты», чтобы не появился второй «Control Center».

| Страница (D8) | Маршрут | Показывает | Действия | Право |
|---|---|---|---|---|
| Обзор агентов | `/agents` | Карточка на агента: вкл/выкл, tier/модель, запуски 24 ч, успех %, p50/p95 длительности, ошибки, стоимость сегодня / бюджет, очередь, последнее событие; сводка платформы: `dead`-задачи, ожидающие одобрения, расход дня | Переход в агента; быстрый kill switch | `agents.view` (kill switch — `agents.manage`) |
| Агент (детально) | `/agents/[key]` | Описание из определения, `prompt_version`, инструменты, триггеры, эффективные права (потолок / дефолт / grant / итог), конфиг, последние запуски, графики стоимости/токенов/ошибок | Вкл/выкл, override модели/tier, бюджеты, `max_tokens`, расписание, правка grants (не мягче потолка); ручной запуск для компании | `agents.view`; правки — `agents.manage`; запуск — `agents.run` |
| Задачи / очередь | `/agents/tasks` | `agent_tasks`: фильтры по статусу (вкл. `dead` = DLQ), агенту, компании, триггеру; attempts, `run_after`, lease, `last_error` | Повторить, отменить, повысить приоритет; повтор из DLQ | `agents.view`; действия — `agents.run` |
| Запуски | `/agents/runs`, `/agents/runs/[id]` | Список `agent_runs`; карточка: вход/выход (summary), модель, tier, `prompt_version`, токены, стоимость, длительность, ошибка; вкладки «Вызовы инструментов» (`agent_tool_calls`: seq, tool, permission, decision, статус, длительность, `args_redacted`) и «События» (`agent_events`); источники | — | `agents.view` |
| Одобрения | `/agents/approvals` | `agent_approvals`: pending (с таймером до `expires_at`), история; summary, право, компания, payload (просмотр), кто и где решил | Approve / Reject с причиной | `approvals.decide` (просмотр — `agents.view`) |
| Расписания | `/agents/schedules` | Cron-триггеры из определений + `agent_configs.schedule_cron`, следующий запуск, последний результат | Изменить/выключить расписание | `agents.manage` |
| Бюджеты и стоимость | `/agents/costs` | Стоимость и токены по дню / агенту / компании / модели / tier; бюджеты и их заполнение; топ дорогих запусков; `BUDGET_EXCEEDED` | Правка бюджетов агента; платформенные лимиты | `agents.view`; правка — `agents.manage` (платформенные — `settings.manage`) |
| События платформы | `/agents/events` | `platform_events` (имя, компания, субъект, `dispatched_at`), недоставленные; поток `agent_events` уровня warn/error | Переотправить недоставленное событие | `agents.view`; переотправка — `agents.run` |
| Интеграции / здоровье | `/agents/integrations` | Inngest (ключи, последняя синхронизация drain), OpenRouter (ключ, ошибки, расход), Telegram (вебхук, секрет, привязанные сотрудники), CRM (последний успех/ошибка по подключениям), вебхуки Meta/WA/Kaspi/MyHonor (приём, ошибки) | Тестовый пинг | `agents.view` |

Покрытие запрошенных представлений:

| Запрошено | Где |
|---|---|
| Agents | Обзор агентов, Агент (детально) |
| Tasks | Задачи / очередь |
| Runs | Запуски |
| Actions / tool calls | Запуски → вкладка «Вызовы инструментов» |
| Errors | Обзор (счётчики), Задачи (`failed`/`dead`), Запуски (фильтр по ошибке), События (warn/error) |
| Logs / events | События платформы + вкладка «События» запуска |
| Schedules | Расписания |
| Integrations health | Интеграции / здоровье (расширяет `/api/giga-admin/system/health`) |
| Permissions | Агент (детально) → эффективные права; grants |
| Costs, Tokens | Бюджеты и стоимость |
| Performance | Обзор агентов (успех %, p50/p95, очередь) и графики в карточке агента |
| Approvals | Одобрения |

«Модерация ИИ» (`/moderation`) остаётся на месте; из «Одобрений» на неё ведёт ссылка (ревью AI-инсайтов перед показом клиенту).

Отчёты и проверка выводов ИИ (фаза 6, реализовано):

| Страница | Маршрут | Показывает | Действия | Право |
|---|---|---|---|---|
| Отчёты | `/reports` | Версии `report_versions`: компания, тип и версия, статус, короткий хеш данных, кто сформировал, уверенность (полнота данных), сколько выводов не вошло до проверки; карточка — снимок с бейджами происхождения, evidence, источники, provenance (агент, запуск, инструменты, модель, промпт) | Опубликовать (`ready`), отклонить, отозвать опубликованную — с подтверждением и причиной; PDF; «Собрать заново» (`agents.run`) | просмотр `agents.view`; решения `reports.publish` |
| Проверка выводов ИИ | `/ai-review` | Непроверенные гипотезы ИИ (`diagnostic_findings`, AI_HYPOTHESIS) и предложения модели (`diagnostic_recommendations`, `…:ai`) с доказательствами, уверенностью, моделью и версией промпта | Показать клиенту (reviewed_by/at + visible) / отклонить с причиной (`dismissed` / `rejected`) | `insights.moderate` (то же право, что у «Модерации ИИ») |

`reports.publish` — новое право (admin и super_admin): `content.publish` относится к CMS и есть у контент-менеджера, `approvals.decide` — к разовым действиям агентов; публикация отчёта решает, что клиент читает о своём бизнесе. Все решения пишутся в `admin_audit_log` до изменения (`required: true`).

## 4. Права

Новые ключи в `PERMISSIONS` (`lib/admin/rbac.ts`):

| Право | Значение |
|---|---|
| `agents.view` | Видеть раздел, запуски, задачи, стоимость, события |
| `agents.run` | Ручной запуск, повтор, отмена, повтор из DLQ, переотправка события |
| `agents.manage` | Вкл/выкл, модели, бюджеты, расписания, grants |
| `approvals.decide` | Решать одобрения в админке и Telegram |

Маппинг на роли — **предложение** (утверждается в Phase 8):

| Роль | agents.view | agents.run | agents.manage | approvals.decide | Комментарий |
|---|---|---|---|---|---|
| super_admin | ✓ | ✓ | ✓ | ✓ | `ALL_PERMISSIONS` |
| admin | ✓ | ✓ | ✓ | ✓ | Получит автоматически: `admin` = все, кроме `roles.manage`, `settings.manage` |
| super_expert | ✓ | ✓ | — | ✓ | Работа с людьми: запуск диагностики, решения по клиентским материалам |
| crm_manager | ✓ | ✓ | — | — | |
| content_manager | — | — | — | — | |
| analyst | ✓ | — | — | — | Только чтение |
| support | ✓ | — | — | — | Только чтение |

Дополнительно: одобрения с правом MODIFY_SYSTEM или DELETE_DATA требуют `approvals.decide` **и** `settings.manage` (на сегодня — только super_admin). Решающий не может одобрить действие против сотрудника равного/старшего ранга (`forbidTarget`).

## 5. Telegram: привязка сотрудника

```
 GIGA (сотрудник с approved-статусом)            /api/giga-admin/...               Бот                  /api/telegram/webhook
   «Привязать Telegram» ──────────────────────► код (случайный), в БД только hash + expires (10 мин)
   показывает код / deep-link ◄───────────────
   сотрудник: /start <code> ─────────────────────────────────────────────────────► update
                                                                                   1. секрет заголовка (обязателен, constant-time)
                                                                                   2. дедуп update_id
                                                                                   3. hash(code) + не истёк → user_id
                                                                                   4. staff_telegram_links(user_id, telegram_user_id, chat_id)
                                                                                   5. recordAdminAction('telegram.link')
                                                    ◄──────────────────────────── «Привязано» ─────────────
```

Сегодняшний клиентский `/start` (`profiles.telegram_chat_id`, 12 hex без TTL) остаётся для клиентов и не даёт прав на одобрения.

## 6. Telegram: поток одобрения

```
 Runner            Postgres                         Notifier                 Telegram API        Сотрудник       Webhook
   │ инструмент → REQUIRE_APPROVAL
   ├─► agent_approvals(pending, payload_hash, expires_at)
   ├─► agent_tasks.status = awaiting_approval
   ├─► emit APPROVAL_REQUESTED ─► notification_events(level=APPROVAL_REQUIRED, approval_id)
   │                                   │
   │                                   ├─ получатели: staff_telegram_links ∩ право approvals.decide ∩ status=approved
   │                                   ├─► sendMessage(карточка: агент, компания, действие, summary, срок;
   │                                   │      inline_keyboard [✅ Approve][❌ Reject],
   │                                   │      callback_data = "ap:<approval_id>:<a|r>:<hmac>")
   │                                   └─► notification_deliveries(sent, provider_message_id)
   │                                                                              ──► карточка ──►│
   │                                                                                               │ нажимает Approve
   │                                                              callback_query ◄─────────────────┘
   │                                                                   │
   │                                                                   └──────────────────────────────────► проверки:
   │                                                                     1. X-Telegram-Bot-Api-Secret-Token: обязателен, constant-time, иначе 401
   │                                                                     2. update_id не обработан
   │                                                                     3. HMAC callback_data верен
   │                                                                     4. from.id → staff_telegram_links → user_id
   │                                                                     5. профиль approved + staff-роль + approvals.decide (+ settings.manage для MODIFY/DELETE)
   │                                                                     6. UPDATE agent_approvals SET status='approved', decided_by, decided_via='telegram'
   │                                                                        WHERE id=… AND status='pending' AND expires_at > now()   (атомарно)
   │                                                                     7. recordAdminAction('approval.decide', required)
   │                                                                     8. answerCallbackQuery + editMessageText («Одобрено: <имя>, <время>») у всех получателей
   │                                                                     9. agent_tasks → queued
   ◄── claim ──┤
   ├─ payload_hash совпадает и срок не истёк → исполнить инструмент → agent_approvals.executed_at, status=executed
   └─ иначе → task failed, AGENT_FAILED
```

| Случай | Поведение |
|---|---|
| Reject | `status=rejected`, причина (из админки; в Telegram — «без комментария» или ответ на сообщение), задача → `cancelled`, карточка редактируется |
| Истёк срок | Reaper: `expired`, задача → `cancelled`, карточки «Истекло», WARNING |
| Решено в админке | `decided_via='admin'`, `requireGiga('approvals.decide')` + CSRF Origin; карточки в Telegram редактируются «Решено в GIGA» |
| Повторное нажатие / второй сотрудник | Шаг 6 атомарен: второе решение получает «Уже решено» |
| Неизвестный / неприв. Telegram-пользователь | Ответ «Нет прав», запись `agent_events` warn, без изменения статуса |

## 7. Telegram-боты: панель администратора и бот экспертов

Три бота, токены только в env (`lib/telegram/bots/registry.ts`):

| Бот | Env | Вебхук | Для кого |
|---|---|---|---|
| клиентский | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | `/api/telegram/webhook` | клиенты (напоминания); до настройки админ-бота — ещё уведомления и одобрения персонала, как раньше |
| админ (@Command_panel_aistart360_bot) | `TELEGRAM_ADMIN_BOT_TOKEN`, `TELEGRAM_ADMIN_BOT_USERNAME`, `TELEGRAM_ADMIN_WEBHOOK_SECRET` | `/api/telegram/admin` | привязанные сотрудники: вся панель GIGA в пределах роли |
| экспертов (@aist360notificationbot) | `TELEGRAM_EXPERT_BOT_TOKEN`, `TELEGRAM_EXPERT_BOT_USERNAME`, `TELEGRAM_EXPERT_WEBHOOK_SECRET` | `/api/telegram/expert` | эксперты (роль `expert` / `admin` / `super_admin`, профиль approved) |

**Маршрутизация.** Как только у админ-бота заданы токен **и** секрет вебхука (`staffBot()`), в него уходят уведомления персонала (`notifyStaff`, включая legacy `TELEGRAM_ADMIN_CHAT_IDS`), карточки одобрений и их закрытие (`closeApprovalCards`, с повтором через клиентского бота для карточек, отправленных до переключения), ссылка привязки из GIGA (`createStaffLinkCode`). Без этого всё работает через `TELEGRAM_BOT_TOKEN`, как до появления ботов. Кнопки одобрения подписываются первым из `TELEGRAM_CALLBACK_SECRET` / `TELEGRAM_ADMIN_WEBHOOK_SECRET` / `TELEGRAM_WEBHOOK_SECRET`, а проверяются любым из них — старые карточки после переключения не ломаются. Сотрудник, привязанный раньше, должен один раз открыть админ-бота и нажать «Start» (бот не может написать первым); привязка (`staff_telegram_links`) общая.

**Каркас** (`lib/telegram/bots/`): `dispatcher.ts` — команды, кнопки главного меню (reply-клавиатура), inline-кнопки, многошаговый ввод; `callback.ts` — подписанные `callback_data` ≤ 64 байт (`<действие>|<аргументы>|<HMAC-9 байт>`, UUID упакован в 22 символа, подпись привязана к боту — кнопку админ-бота нельзя нажать в боте экспертов); `store.ts` — состояние диалога и дедуп `update_id` по боту (миграция `095`); `webhook.ts` — секрет заголовка в постоянном времени, fail closed без токена или секрета (503), 401 на неверный секрет, иначе всегда 200; лимит 40 запросов в минуту на чат; только личные чаты. Ошибка обработчика логируется без подробностей и даёт в чат «Не удалось выполнить действие».

**Подтверждение.** Отключение агента, отмена задачи, отказ по заявке, публикация отчёта, «Запустить диагностику», выключение/удаление провайдера и ключа, смена маршрута модели и бюджета — только после кнопки «Подтвердить». Кнопка несёт одноразовый nonce из состояния чата (5 минут); подтверждённые обработчики достижимы только через неё; повторное нажатие — «Подтверждение устарело».

**Аудит.** Каждое изменение пишется в `admin_audit_log` с `actor_kind = 'telegram'`, id сотрудника, ролью и `metadata.via = 'telegram'` — теми же функциями, что и маршруты GIGA (до изменения, `required: true`, где так делает маршрут). Провайдеры, ключи, маршруты и бюджеты пишет сервис `lib/ai/providers/service.ts` (`actor_id = telegram:<id сотрудника>`).

### 7.1 Меню админ-бота ↔ права

Те же права, что у маршрута GIGA, который делает то же самое. Пункты меню и кнопки, на которые нет права, не показываются; нажатие подделанной/старой кнопки всё равно проверяется на сервере («⛔ Недостаточно прав», ничего не меняется).

| Раздел / действие | Право | Маршрут GIGA с тем же правом | Код |
|---|---|---|---|
| 📊 Статус (раздел) | `dashboard.view` | `notifications` | `admin/status.ts` |
| — БД и полнота env (только счётчики) | `settings.manage` | `system/health` | |
| — очередь, расход ИИ к бюджету, мониторинг, одобрения, последние сбои | `agents.view` | `agents`, `agents/costs` | |
| — заявки на доступ | `users.view` | `requests` (GET) | |
| 🤖 Агенты: список, карточка, задачи с фильтрами, карточка задачи (попытки, стоимость, инструменты с решениями прав) | `agents.view` | `agents`, `agents/:key`, `agents/tasks`, `agents/tasks/:id` | `admin/agents.ts` |
| — включить / выключить (✓ подтверждение) | `agents.manage` | `PATCH agents/:key` | `updateAgentConfigAudited` |
| — запустить (агент компании: поиск компании по названию/email) | `agents.run` | `POST agents/:key/run` | `runAgentManually` |
| — повторить / отменить (✓) задачу | `agents.run` | `POST agents/tasks/:id` | `agentTaskAction` |
| ✅ Одобрения: список | `agents.view` | `agents/approvals` | `admin/approvals.ts` |
| — одобрить / отклонить (подписанные кнопки `ap:` как в карточках) | `approvals.decide` | `POST agents/approvals/:id` | `handleApprovalCallback` |
| 👤 Заявки, поиск и карточка пользователя | `users.view` (контакты без маски — `users.sensitive`) | `requests`, `users` | `admin/users.ts` |
| — одобрить / отклонить (причина + ✓) заявку | `users.approve` | `PATCH requests/:id` | `decideAccessRequest` |
| 🏢 Клиенты: поиск, недавние, карточка (Точка А, полнота, пробелы, критические выводы, последняя сессия/этап), сессии | `users.view` | `clients` | `admin/clients.ts` |
| — непроверенные гипотезы ИИ в карточке | `insights.moderate` | `ai-review` | |
| — «Запустить диагностику» (✓) | `users.view` + `agents.run` | `POST agents/diagnostic_orchestrator/run` | `runAgentManually` |
| 📄 Проверка выводов ИИ: очередь, показать клиенту, скрыть (причина + ✓) | `insights.moderate` | `ai-review`, `POST ai-review/:kind/:id` | `reviewAiItem` |
| 📄 Версии отчётов | `agents.view` | `reports` | `admin/reports.ts` |
| — опубликовать готовую версию (✓) | `reports.publish` | `POST reports/:id` | `transitionReportVersion` |
| 🔑 Провайдеры и ключи: список (ключи только маской), карточки провайдера и ключа, маршруты | `agents.view` | `GET ai-providers`, `ai-providers/:id`, `ai-providers/routes` | `admin/providers.ts` → `lib/ai/providers/service.ts` |
| — добавить провайдера (название → ключ → URL → тип), добавить / заменить / проверить ключ, вкл/выкл, удалить (✓), модели, маршрут возможность/уровень → модель (✓) | `settings.manage` | мутации `ai-providers/**`, `credentials/:id/verify` | |
| 💸 Расходы за сутки / 7 / 30 дней по провайдерам, моделям, функциям, компаниям; бюджеты | `agents.view` | сервис (чтение расходов — `agents.view`) | `admin/spend.ts` |
| — изменить бюджет (✓) | `settings.manage` | сервис | `setBudgets` |
| 🔔 Уведомления: свой уровень и «без звука» 1/8/24 ч; тихие часы платформы — только показ | `dashboard.view` | `telegram-link` | `admin/notifications.ts` |

**Ключи API.** Бот просит прислать ключ одним сообщением, **сначала удаляет это сообщение** (`deleteMessage`), затем передаёт текст в `addCredential` / `rotateCredential` (шифрование `SECRETS_ENCRYPTION_KEY` в сервисе) и отвечает только маской «••••abcd». Ключ не попадает в состояние диалога, аудит и ответы. Если Telegram не дал удалить сообщение — бот просит удалить его вручную. Похожее на ключ сообщение вне режима ввода ключа тоже удаляется.

**Общая логика с маршрутами** вынесена в библиотеку, маршруты переписаны на неё с теми же ответами: `lib/admin/staff-actions.ts` (`runAgentManually`, `agentTaskAction`, `updateAgentConfigAudited`, `transitionReportVersion`, `reviewAiItem`), `lib/users/access-requests.ts` (`decideAccessRequest`), `lib/admin/system-health.ts` (список env для «Системы» и «Статуса»).

### 7.2 Бот экспертов

Привязка: кабинет эксперта → «Мой профиль» → «Привязать Telegram» (`/api/expert/telegram-link`, `requireExpert`) → одноразовая ссылка 15 минут `t.me/<бот>?start=expert_<код>`; в БД только SHA-256 кода (`telegram_bot_links`, bot = `expert`). Доступ проверяется на каждом апдейте: профиль approved и роль из `EXPERT_ROLES`.

| Раздел | Что показывает | Область видимости |
|---|---|---|
| 👥 Клиенты | поиск, недавние; карточка: компания, Точка А (балл, зрелость), полнота, пробелы в данных, главные выводы, последняя сессия | все компании — как `/api/expert/clients` (назначения эксперт↔клиент в схеме нет); непроверенные гипотезы ИИ показываются с пометкой «не проверена» — платформенный персонал (включая `expert`) видит их по RLS 085 |
| 🩺 Диагностики | последние сессии: статус, этап, полнота | все компании |
| 📄 Отчёты | только опубликованные версии; PDF — ссылка на `/api/v1/reports/:id/pdf`, которая сама проверяет доступ (нужен вход в кабинет в браузере) | как `/expert/reports` |
| 🔔 Уведомления | свой уровень и «без звука» | — |

Эксперт ничего не меняет в системе; единственная запись — свои настройки уведомлений (с записью в аудит).

Уведомления экспертам (`lib/telegram/bots/expert/notify.ts`): «Диагностика завершена» (событие `DIAGNOSTIC_COMPLETED` через `routeEventToStaff`), «Отчёт опубликован» (`transitionReportVersion`), «Новый клиент одобрен» (`decideAccessRequest`). Учитываются личный уровень (по умолчанию INFO), «без звука» и тихие часы платформы; порог Telegram для персонала (WARNING) к экспертам не применяется — это их рабочие события. Одна доставка на ключ (`telegram_bot_deliveries`). Пока бот экспертов не настроен, ничего не читается и не отправляется.

### 7.3 Настройка

```bash
npx tsx scripts/telegram/set-webhooks.ts https://<прод-домен>            # все боты с токеном
npx tsx scripts/telegram/set-webhooks.ts https://<домен> --bots admin    # один бот
npx tsx scripts/telegram/set-webhooks.ts https://<домен> --info          # только getWebhookInfo
```

Скрипт берёт токены и секреты из env, регистрирует `setWebhook` с `secret_token` и `allowed_updates = [message, callback_query]`, ставит русские команды (`setMyCommands`) и печатает `getWebhookInfo`; токены не печатает. Бот без секрета не регистрируется. Preview-деплой Vercel с Deployment Protection отвечает Telegram 401 — регистрировать вебхуки на прод-домене или на preview с отключённой защитой / bypass.

Не проверено вживую (нет сети в контейнере): реальные вызовы Bot API, удаление сообщения с ключом на стороне Telegram, отображение клавиатур в клиентах Telegram. Покрыто тестами на записывающем `fetch`: `tests/unit/telegram/*`, `tests/integration/db/telegram-bots.test.ts`.

## 8. Провайдеры и ключи

Страница GIGA «ИИ и автоматизация» → «Провайдеры и ключи» (`/admin-giga-panel/ai-providers`, `components/giga-panel/ai-providers/*`, пункт меню после «Стоимость ИИ»). Полное управление провайдерами языковых моделей (OpenRouter, Alem Plus и любые OpenAI-совместимые), ключами API, моделями и ценами, маршрутизацией, дневными бюджетами и расходами. Всё идёт через единый сервис `lib/ai/providers/service.ts` (тот же, что у админ-бота, §7.1); таблицы миграции 094 описаны в [05-agents.md §8.1](05-agents.md).

**Права.** Просмотр — `agents.view` (super_admin, admin, crm_manager, analyst); любое изменение, включая добавление, замену и проверку ключа, — `settings.manage` (только super_admin). Без `settings.manage` страница открывается в режиме просмотра: кнопок изменений нет, вверху пояснение «Режим просмотра…». Сервер проверяет право на каждом маршруте до обращения к сервису.

| Вкладка | Что показывает | Действия (`settings.manage`) |
|---|---|---|
| Провайдеры | Карточка провайдера: название, ключ, тип, base URL, пути chat / embeddings / rerank, режим OCR, поддержка `response_format`, имена доп. заголовков, заметка о приватности, вкл/выкл; расход сегодня против дневного бюджета провайдера; ключи (название, маска `••••abcd`, вкл/выкл, результат и время последней проверки, за какими моделями закреплён); модели (id, возможность, ключ, цены за 1M токенов вход/выход, маршруты); какие маршруты провайдер обслуживает | Добавить / изменить провайдера (валидация полей; ошибки сервиса показываются у поля), вкл/выкл, удалить (ввод ключа провайдера для подтверждения; удаляет ключи, модели и маршруты); добавить ключ, «Проверить», сменить ключ, вкл/выкл, удалить (подтверждение); добавить / изменить / удалить модель (подтверждение) |
| Маршрутизация | Шесть слотов: чат light / standard / premium, эмбеддинги, rerank, OCR → модель или «по умолчанию (OpenRouter из env)»; что будет без маршрута; почему настроенный маршрут сейчас не используется (провайдер/модель выключены, нет ключа) | Выбрать модель и «Сохранить» (подтверждение с описанием изменения); пустой выбор сбрасывает маршрут |
| Бюджеты | Платформа в сутки и одна компания в сутки: значение, источник (БД / env), расход сегодня; дневной бюджет и расход каждого провайдера | «Изменить бюджеты» → форма → подтверждение со списком изменений «было → стало»; пустое поле возвращает env (платформа, компания) или снимает лимит провайдера |
| Расходы | За 24 часа / 7 / 30 дней по провайдеру / модели / функции / компании: итог, вызовы, токены, бары топ-10 и таблица (до 200 строк) из `spendSummary()`; строки без провайдера (до 094) и без компании подписаны. По дням и агентам — «Стоимость ИИ» (`/agents/costs`) | — |

**Ключи API.** Секрет принимается только в теле `POST …/:id/credentials` и `POST …/credentials/:id/rotate`; поле ввода `type=password`, никогда не заполнено заранее и очищается после каждой отправки и при закрытии окна. Сервис шифрует ключ `SECRETS_ENCRYPTION_KEY` (AES-256-GCM); ни один ответ не содержит секрета или шифртекста — только маску. Ошибки маршрутов с ключом очищаются от присланного секрета и никогда не повторяют сырой текст ошибки драйвера. Без `SECRETS_ENCRYPTION_KEY` страница предупреждает, кнопки добавления и замены ключа выключены, сервер отвечает 503 `ENCRYPTION_NOT_CONFIGURED`. «Проверить» делает минимальный реальный вызов (чат на 1 токен, один эмбеддинг или `GET /models`) и сохраняет результат; ошибка провайдера показывается без ключа.

**API** (`app/api/giga-admin/ai-providers/**`, `dynamic = 'force-dynamic'`, без кэша):

| Метод и путь | Право | Сервис |
|---|---|---|
| `GET /ai-providers` | `agents.view` | `listProviders` + `encryptionConfigured` |
| `POST /ai-providers` | `settings.manage` | `createProvider` |
| `GET /ai-providers/:id` (id или ключ) | `agents.view` | `getProvider` |
| `PATCH`, `DELETE /ai-providers/:id` | `settings.manage` | `updateProvider`, `deleteProvider` |
| `POST /ai-providers/:id/credentials` `{label, secret}` | `settings.manage` | `addCredential` |
| `PATCH /ai-providers/credentials/:credentialId` `{label?, enabled?}` (поле `secret` → 400) | `settings.manage` | `updateCredential` |
| `DELETE /ai-providers/credentials/:credentialId` | `settings.manage` | `deleteCredential` |
| `POST /ai-providers/credentials/:credentialId/rotate` `{secret}` | `settings.manage` | `rotateCredential` |
| `POST /ai-providers/credentials/:credentialId/verify` | `settings.manage` | `verifyCredential` → `{ok:true, result}` |
| `POST /ai-providers/models` (upsert по провайдеру + id модели + возможности) | `settings.manage` | `upsertModel` |
| `DELETE /ai-providers/models/:modelId` | `settings.manage` | `deleteModel` |
| `GET /ai-providers/routes` | `agents.view` | `listRoutes` |
| `PUT /ai-providers/routes` `{capability, tier, modelRowId \| null}` | `settings.manage` | `setRoute` |
| `GET /ai-providers/budgets` | `agents.view` | `getBudgets` |
| `PUT /ai-providers/budgets` | `settings.manage` | `setBudgets` |
| `GET /ai-providers/spend?days=1..366&groupBy=provider\|model\|feature\|company` | `agents.view` | `spendSummary` |

Ошибки: `ProviderServiceError` → её статус (400 / 404 / 409 / 503), русское сообщение и `code`; недоступный журнал аудита → 503 `AUDIT_UNAVAILABLE` (изменение не выполнено); прочее → 500 через `safeErrorMessage`. Каждое изменение пишется сервисом в `admin_audit_log` до выполнения (`ai.provider.*`, `ai.credential.*`, `ai.model.*`, `ai.route.*`, `ai.budgets.update`) с сотрудником-исполнителем. Общая обвязка маршрутов — `lib/admin/ai-providers-http.ts`.

«Стоимость ИИ» (`GET /api/giga-admin/agents/costs`) показывает действующие бюджеты платформы и компании из `getBudgets()` с источником (заданы в панели / env); без таблиц 094 — значения env.

Тесты: `tests/unit/api/ai-providers-routes.test.ts` (права → 403 без обращения к сервису, секрет не появляется ни в одном ответе и аудите, маппинг ошибок, валидация), `tests/unit/giga-crm/ai-providers-ui.test.ts` (модель представления и рендер карточки, маршрутов, бюджетов, расходов, окна ключа), `tests/e2e/giga-providers.spec.ts` (страница с засеянными `alem` и `openrouter`; пропускается без `E2E_DATABASE_URL`).
