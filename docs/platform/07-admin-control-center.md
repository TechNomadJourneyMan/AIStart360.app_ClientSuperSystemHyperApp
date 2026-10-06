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

Слабые места GIGA сегодня: MFA step-up проверяется только для страниц, не для API (`verifyStepUp` без вызовов); break-glass-действия не атрибутируются человеку (`giga:super_admin`); мёртвый `components/giga-panel/GigaAccessGuard.tsx`.

## 2. Legacy-поверхности (вывести)

| Поверхность | Маршруты | Почему | Замена | Фаза |
|---|---|---|---|---|
| Legacy «/admin» | `/admin`, `/admin/requests` | Prisma-эпоха; другие guard-ы; дублирует GIGA | Редирект в GIGA | 13 |
| `/api/admin/*` (16) | overview, requests, audit, users… | `lib/rbac.ts` (expert→MANAGER открывает API экспертам); `overview` принимает break-glass без `break_glass_enabled` | `/api/giga-admin/*` | 13 |
| `/api/v1/admin/*` (5) | approve-user, users/[id]/approve\|reject, pending-users, clients | Нет проверки статуса/ранга/MFA: admin блокирует super_admin; `clients` вызывает `auth.admin.createUser` на anon-клиенте (всегда падает) | GIGA `requests` (`users.approve` + `forbidTarget`) | 2 (закрыть), 13 (удалить) |
| `/owner/**` | 19 страниц, 15 — реэкспорты | `/owner/admin` сломан по дизайну (owner → CLIENT) | Клиентский кабинет + GIGA | 13 |
| `(dashboard)/users`, `/team` | — | localStorage-мок; Prisma `user` | GIGA `/users`, `/staff` | 13 |
| `(dashboard)/intelligence`, `/reports`, `/analytics` | — | Константы, заглушки, фильтры без обработчиков | GIGA «ИИ-агенты» / отчёты | 13 |
| `/api/notifications*` + Prisma `notifications` | — | NextAuth-only, недостижимо; `send` — латентный спам-вектор | `notification_events` | 7, 13 |
| `app/actions/auth.ts`, `app/actions/reports.ts` | — | Нет вызовов; запись на диск Vercel, cookie-атрибуция | — | 13 |

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
