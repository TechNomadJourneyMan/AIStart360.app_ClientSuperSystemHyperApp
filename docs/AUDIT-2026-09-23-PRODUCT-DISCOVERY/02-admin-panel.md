# 02 · Аудит админ-панели (GIGA-CRM)

> Product discovery 2026-09-23. Аудит по коду, без изменений в данных. Статусы: EXISTING / IMPROVEMENT / MISSING / UNCLEAR.
> Учтены прошлые аудиты `docs/AUDIT-admin-panel-2026-07-04.md` и `docs/AUDIT-2026-09-17-PLATFORM-REDESIGN.md`: уже исправленное повторно не предлагается.
> Идеи здесь черновые; сводный backlog с ID — в [00-summary.md](00-summary.md).

## 1. Карта админки

### 1.1 Пространства имён: их по-прежнему три с половиной

| Пространство | Где | Авторизация | Хранилище | Статус |
|---|---|---|---|---|
| **GIGA-CRM** (основное) | `app/admin-giga-panel/**` (22 страницы), `app/api/giga-admin/**` (~70 маршрутов) | `requireGiga(req, perm)` (`lib/admin/giga-actor.ts`): личная сессия или staff-cookie, матрица прав `lib/admin/rbac.ts`, CSRF по Origin | Supabase (service-role) | Актуальное |
| **SuperExpert** | `/super-expert/**` (`SUPER_EXPERT_NAV` в `lib/admin/nav.ts`) | те же `requireGiga` | те же таблицы | Актуальное |
| **Legacy v1** | `app/api/v1/admin/{approve-user,pending-users,clients,users/[id]/approve,reject}` | `requireSupabaseAdmin()` (`lib/supabase-admin-guard.ts`): только `profiles.role ∈ {admin, super_admin}` | Supabase | **Живое**: вызывается из `app/(dashboard)/admin/page.tsx` → `PendingClientsTable`, `AdminClientsList`, `components/clients/ClientsTable.tsx` |
| **Legacy Prisma** | `app/api/admin/**` (15 маршрутов) | `requirePermission` (`lib/rbac.ts`) | Prisma `users`/`sessions`/`audit_logs` (NextAuth; прод-авторизация сюда не пишет) | Полумёртвое; его читает `app/(dashboard)/admin/requests/page.tsx` |
| Owner-кабинет | `app/(owner)/owner/admin/page.tsx` | реэкспорт `(dashboard)/admin` | — | Дубликат |

### 1.2 Разделы GIGA-CRM

| Группа | Раздел → маршрут | Основные API | Таблицы и RPC |
|---|---|---|---|
| Обзор | Главная `/admin-giga-panel` | `overview` | `admin_overview`, `admin_journey_stages` |
| Пользователи | `users`, `users/[id]` (User 360, 11 вкладок) | `users`, `users/export`, `users/bulk-remind`, `users/[id]/{profile,block,unblock,archive,purge,2fa-reset,access,widgets,staff-role,company,survey,gri,notes,tasks,assignment,emails,events,audit,quality,remind-survey}` | `profiles`, `companies`, `staff_roles`, `user_notes`, `staff_tasks`, `user_assignments`, `email_deliveries`, `admin_list_users`, `admin_purge_user` |
| | `requests`, `invites`, `clients`, `duplicates`, `leads` | `requests/*`, `invites`, `clients`, `duplicates`, `leads/*` | `admin_requests`, `platform_invitations`, `mini_gri_leads` |
| Данные | `surveys`, `gri`, `activity`, `cjm` | `surveys/*`, `gri/*`, `activity`, `cjm` | `survey_answers`, `survey_answer_history`, `gri_assessments`, `gri_assessment_drafts`, `user_events` |
| Коммуникации | `inbox`, `market`, `moderation` | `omnichannel/*`, `market-analysis`, `insights/*` | `omnichannel_*`, `point_a_insights` |
| Платформа | `content`, `content/[id]`, `sections`, `settings` | `content/*`, `sections`, `settings/*`, `system/{health,purge-events}` | `cms_pages`, `cms_blocks`, `cms_page_revisions`, `platform_sections`, `system_settings` |
| Безопасность | `staff`, `impersonation`, `audit` | `staff`, `staff/list`, `impersonation/*`, `audit` | `staff_roles`, `impersonation_sessions`, `admin_audit_log` (append-only) |

Роли: 7 (super_admin, admin, super_expert, crm_manager, content_manager, analyst, support), 33 права, матрица в коде. Вход владельца — `/giga-login` (email + scrypt-хеш из env → magic-link-сессия). Остальной персонал входит обычным логином.

## 2. Аудит по категориям

### 2.1 Пользователи

| Функция | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Список, пагинация, сортировка | EXISTING | `UsersPage.tsx`, `admin_list_users` (082), до 200 на страницу, 6 сортировок | Серверный курсор вместо `count(*) OVER()` + OFFSET |
| Поиск | EXISTING | ILIKE по email, имени, компании, организации, телефону, id; debounce 350 мс | Trigram-индекс; экранирование `%`/`_`; поиск по ИНН/БИН и тегам |
| Фильтры и сегменты | EXISTING | статус, роль, 11 фиксированных сегментов | Конструктор сегментов, сохранённые фильтры, «мои клиенты», тариф, отрасль |
| User 360 | EXISTING | 11 вкладок | Вкладки «Коммуникации» (omnichannel) и «Обращения к эксперту» (`expert_cases` в GIGA не видны) |
| История действий | EXISTING | вкладка «История», `survey_answer_history` | Единая лента «всё о клиенте» |
| Статусы | IMPROVEMENT | миграция `059_admin_actor_and_block_status.sql` добавляет `blocked`/`archived` в CHECK; в 060–083 ограничение не трогается. На проде CHECK старый, значит 059 **не применена** | Применить 059 (идемпотентна) |
| Роли персонала | EXISTING | `users/[id]/staff-role`, `grantableRoles`, ранги | **Смены `profiles.role` (client ↔ expert ↔ owner) нет** |
| Права отдельного пользователя | EXISTING | `users/[id]/access`: tier + 4 feature_flags | Срок действия (Pro до даты) и причина |
| Блокировка | IMPROVEMENT | статус + бан GoTrue; аудит через legacy `logAudit` | На проде падает из-за CHECK; в журнале нет `actor_role`/`actor_email`; причина не спрашивается |
| Восстановление | IMPROVEMENT | `unblock`, `archive {restore}` | Всегда ставит `approved` и теряет прежний статус; undo нет |
| Полное удаление (purge) | EXISTING (новое) | dry-run, повторный ввод email, причина, rate-limit; компенсирующая запись `user.purge_failed` (добавлена 2026-09-23) | Step-up/2FA перед удалением; серверный `confirmEmail` проверяет от ошибки, но не от угнанной сессии |
| Массовые действия | IMPROVEMENT | только `bulk-remind` (до 50) | Одобрение, блокировка, тариф, ответственный, тег, экспорт выбранных |
| Импорт | MISSING | — | CSV-импорт клиентов и лидов |
| Экспорт | EXISTING | CSV до 5000, маскирование без `users.sensitive` | **Не пишется в аудит**; нет выбора колонок и XLSX; выгрузка синхронная |
| Заметки | EXISTING | `user_notes`, pin, аудит | Упоминания и уведомления |
| Задачи и ответственный | EXISTING | `staff_tasks`, `user_assignments` | **Нет экранов «Мои задачи» / «Мои клиенты»**; `tasks/[taskId]` PATCH без аудита |
| История взаимодействий | IMPROVEMENT | письма, заметки | Звонки, встречи и диалоги inbox к карточке не привязаны |
| Дубликаты | EXISTING | `duplicates/route.ts` | Слияния нет; лимит 5000 (§5) |
| Заявки на доступ | EXISTING | `lib/users/approval.ts`, `RejectModal` | Всё ещё 4 точки одобрения |

### 2.2 Эксперты

| Функция | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Управление экспертами | MISSING | в GIGA эксперт — только значение фильтра «роль» (`UsersPage.tsx:46`) | Раздел «Эксперты» |
| Профили и компетенции | MISSING (в GIGA) | `app/api/expert/profile` правит только сам эксперт | Компетенции, отрасли, грейд |
| Распределение клиентов | IMPROVEMENT | `staff/list` отдаёт только `staff_roles`: эксперт с `profiles.role='expert'` не попадает в выпадающий список | Назначение эксперта на клиента |
| Скоуп эксперта | IMPROVEMENT | `app/api/expert/clients/route.ts:61` отдаёт всех клиентов | Скоуп по назначению |
| Загрузка, KPI, качество, рейтинг | MISSING | — | Клиентов на эксперта, SLA, NPS |
| Эскалации | IMPROVEMENT | `expert_cases` видны только в кабинете эксперта | Очередь в GIGA, SLA |
| Расписание | MISSING | — | — |

### 2.3 Контент и CMS

| Функция | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Создание и редактирование | EXISTING | блочный редактор, 8 типов блоков, медиатека | — |
| Публикация и черновики | IMPROVEMENT | draft/published/archived | **Правка опубликованной страницы сразу уходит в прод** |
| Версии | EXISTING | `cms_page_revisions`, восстановление, оптимистическая блокировка | Diff; ошибка вставки ревизии игнорируется |
| Категории | IMPROVEMENT | одно текстовое поле | Справочник |
| Теги | MISSING | — | — |
| Поиск и фильтр | EXISTING | поиск и фильтр по статусу | — |
| Массовое редактирование | MISSING | — | — |
| Архив | EXISTING | `archived`; удаляется только неопубликованная страница | — |
| Планирование публикации | MISSING | нет `publish_at` | — |
| Согласование | MISSING | content_manager публикует сам | Опционально |
| Аналитика контента | IMPROVEMENT | событие `CONTENT_VIEWED` есть | Просмотры по странице в CMS |

### 2.4 Модерация

| Функция | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Очередь | EXISTING (узко) | только ИИ-инсайты (`point_a_insights`), `InsightModerationModule.tsx` | Единая очередь |
| Жалобы | MISSING | — | — |
| Флаги | MISSING | omnichannel-guardrails в очередь не попадают | Авто-флаги |
| История решений | IMPROVEMENT | причина хранится только в `metadata` журнала | Причина в строке инсайта |
| Причины отклонения | IMPROVEMENT | произвольный текст | Справочник причин |
| Повторная проверка | UNCLEAR | возврат в очередь не найден | — |
| Массовые решения | MISSING | — | — |
| Аудит | EXISTING | неизменяемый журнал | Экспорт |

### 2.5 Аналитика

| Метрика | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Overview | EXISTING | `admin_overview` | — |
| DAU/WAU/MAU | IMPROVEMENT | снимок по `last_seen_at`, истории нет | Ряды, stickiness |
| Retention и когорты | MISSING | — | — |
| Activation | MISSING | нет определения | решение владельца |
| Conversion | IMPROVEMENT | воронка есть, Free→Pro нет | — |
| Engagement | EXISTING | `admin_activity_stats` | Время в продукте |
| Completion | EXISTING | анкета по шагам | — |
| Funnel и CJM | EXISTING | `cjm/route.ts` | Расхождение с главной на больших объёмах (§5) |
| Сегменты | IMPROVEMENT | 11 фиксированных | Сравнение сегментов |
| Бенчмарк GRI | EXISTING | `gri/benchmark` | — |
| Экспорт аналитики | MISSING | — | — |
| Кастомные отчёты | MISSING | — | — |

### 2.6 Управление платформой

| Функция | Статус | Факты | Чего не хватает |
|---|---|---|---|
| Роли и права | EXISTING | 7 ролей, 33 права, ранги | — |
| Feature flags | IMPROVEMENT | per-user (4 + tier), глобальные в реестре | Процентный rollout, флаги по сегменту |
| Настройки | EXISTING | реестр с zod, fail-safe | — |
| Разделы и видимость | EXISTING | `platform_sections` | — |
| Интеграции | IMPROVEMENT | UI только у omnichannel и WhatsApp; остальное через env | Экран статусов интеграций |
| Уведомления администраторам | EXISTING | `cron/crm-digest` | Эскалация по SLA |
| Шаблоны писем | IMPROVEMENT | в коде `lib/email/` | Редактор в панели |
| Автоматизации | MISSING | один дайджест, ручной bulk-remind | Правила «если–то» |
| Audit log | EXISTING | неизменяемый, с фильтрами | Экспорт; внешняя копия или hash-chain |
| Системные события | IMPROVEMENT | `purge-events` только вручную | **`events_retention_days` сама ничего не удаляет** |
| Безопасность | IMPROVEMENT | CSRF, rate-limit, impersonation с TTL, 2FA-reset | `staff_require_mfa` по умолчанию `false`; без Upstash rate-limit живёт в памяти; нет алертов |

## 3. UX-проблемы по сценариям

**Admin → User**
1. Блокировка и архивация на проде отвечают 409/500 с текстом для разработчика («применена ли миграция 059?»).
2. Блокировка не спрашивает причину, архивация спрашивает. Восстановление всегда ставит `approved`.
3. Массово можно только напомнить про анкету: 30 заявок — это 30 циклов «открыть → решить → закрыть».
4. Нет входящих «Мои клиенты / Мои задачи»: задачи с дедлайнами живут внутри карточек.
5. Нет единой хронологии клиента: картина собирается по 5–6 вкладкам.
6. Экспорт идёт без подтверждения и без записи в журнал.
7. `/giga-login` принимает только владельца, ссылки для сотрудников на обычный вход нет (так задумано 2026-09-23, но сотрудника это путает).

**Admin → Expert.** Сценария нет: сделать клиента экспертом, назначить ему клиентов, посмотреть нагрузку — всё только через SQL.

**Admin → Content.** Правка опубликованной страницы сразу меняет прод. Если `cms_blocks.insert` упадёт после `delete`, страница у клиентов станет пустой. Нет отложенной публикации, массовых действий и статистики просмотров.

**Admin → Moderation.** Решения по одному, причина — свободный текст, пересмотра нет. Ответы ИИ в omnichannel, отзывы и `expert_cases` в очередь не попадают.

**Admin → Analytics.** «Активные за 7 дней» — снимок без истории. Цифры главной и CJM при росте начнут расходиться. Воронку и активность выгрузить нельзя.

**Сквозное.** Есть тосты и подтверждения с `requireText`. Нет: undo в течение N секунд, сохранённых представлений, горячих клавиш для решений в очереди.

## 4. Критические находки

- **К1. Блокировка и архивация не работают на проде.** Миграция 059 в репо есть, на проде, судя по CHECK, не применена. `block/route.ts` отвечает 409. `archive/route.ts` сначала пишет в неизменяемый журнал `user.archived` (`required: true`), потом update падает с 500: в журнале остаётся **фантомная запись**, которую нельзя удалить. Проверка blocked/archived в `middleware.ts:257` на проде мертва. Та же схема «аудит до действия без компенсирующей записи» есть в `content DELETE` (в purge исправлено 2026-09-23).
- **К2. Legacy `/api/v1/admin/*` обходит модель безопасности GIGA и при этом используется.** Нет `staff_roles`, проверки `status`, CSRF и аудита (`lib/supabase-admin-guard.ts:16,53`). `v1/admin/clients` POST создаёт пользователя с паролем, который задаёт администратор. `app/api/admin/users/[id]/block` блокирует пользователя в Prisma `users`, которую прод не читает: блокировка только кажется сработавшей.
- **К3. 2FA для персонала по умолчанию выключена** (`registry.ts:90-92`), вход владельца однофакторный, rate-limit без Upstash живёт в памяти инстанса, блокировки по аккаунту нет.
- **К4. Purge без step-up.** Ввод email проверяется только в UI; повторной аутентификации нет. `old_value` журнала навсегда хранит email и имя удалённого — конфликт с правом на удаление. Внешние копии (Resend, Google Sheets, Telegram, omnichannel) не удаляются — UNCLEAR.
- **К5. Сохранение в CMS не транзакционно, а правки идут прямо в опубликованное** (`content/pages/[id]/route.ts` PUT: update → delete blocks → insert).
- **К6. Мутации и выгрузки без аудита:** `leads/[id]` PATCH, `market-analysis` PATCH/POST, `tasks/[taskId]` PATCH, `users/export` GET, legacy v1. `block`/`unblock`/вход пишут через `logAudit` без роли и email актора.
- **К7. Эксперт видит всех клиентов** (`app/api/expert/clients/route.ts:61`).

## 5. Что сломается при росте ×10

| # | Что | Почему | Когда |
|---|---|---|---|
| 1 | Молча урезанные данные | PostgREST `max_rows` по умолчанию 1000 (на проде UNKNOWN — NEEDS VERIFICATION); `clients` читает всё без limit; `duplicates`/`gri/benchmark` с `.limit(5000)` упираются в cap; RPC CJM тоже | ~1000 клиентов, `diagnostics` раньше |
| 2 | Список пользователей | `admin_list_users` каждый раз агрегирует все `survey_answers`, GRI, диагностики; `count(*) OVER()`; ILIKE без trigram | 10–50 тыс. пользователей |
| 3 | `user_events` | PAGE_VIEWED на каждую страницу, 365 дней, **автоочистки нет**; главная сканирует до 180 дней с `count(DISTINCT)` | Главная замедлится первой |
| 4 | `admin_journey_stages` | коррелированные подзапросы на каждого клиента, дальше JS | Линейный рост |
| 5 | Экспорт | синхронный CSV упрётся в таймаут serverless | — |
| 6 | Операции | одобрение вручную, нет очереди и SLA; владелец — единственный super_admin | ×10 заявок = ×10 кликов |
| 7 | Эксперты | `expert/clients` без пагинации | Раньше GIGA |
| 8 | Rate-limit | без Upstash — в памяти каждого инстанса | Лимиты фактически не работают |
| 9 | Дубликаты | O(n) в JS по 5000 строк + cap 1000 | Дубликаты после первой 1000 не найдутся |

## 6. Идеи (черновые, A1–A27)

| # | Идея | Проблема | Решение | Сложн. | Эффект | Зависимости | Уже есть? |
|---|---|---|---|---|---|---|---|
| A1 | Применить 059 и компенсирующий аудит | блок и архив сломаны | миграция; `*.failed` при ошибке после required-аудита | S | Критический | доступ к прод-БД | Частично |
| A2 | Закрыть legacy-админку | обход RBAC, CSRF, аудита | `/admin` → GIGA; v1 → `requireGiga`; удалить Prisma `/api/admin` | M | Высокий | A1 | Нет |
| A3 | Обязательная 2FA и step-up | однофакторный доступ | `staff_require_mfa=true`; TOTP для purge, экспорта, ролей | M | Высокий | enrol персонала | Частично |
| A4 | Входящие «Мои клиенты / Мои задачи» | не с чего начать день | страница `/tasks` + фильтр assignee | S | Высокий | — | Есть основа |
| A5 | Массовые действия | 30 заявок = 30 циклов | bulk с предпросмотром и отчётом | M | Высокий | A1 | Частично |
| A6 | Единая хронология клиента | история по 6 вкладкам | вкладка «Лента» | M | Высокий | — | Нет |
| A7 | Модуль «Эксперты» | экспертами не управлять | список, роль, компетенции, назначение, нагрузка | L | Высокий | A8 | Нет |
| A8 | Скоуп эксперта | видит всех | фильтр по `user_assignments` | S | Высокий | — | Нет |
| A9 | Очередь эскалаций с SLA | «Позвать эксперта» теряется | `expert_cases` в GIGA + SLA + алерт | M | Высокий | A7 | Частично |
| A10 | Единая очередь модерации | модерируются только инсайты | типы, справочник причин, повторная проверка, хоткеи | M | Средний | — | Частично |
| A11 | Жалобы клиента | некуда сообщить о неверном ответе ИИ | кнопка → очередь A10 | S | Средний | A10 | Нет |
| A12 | Транзакционная CMS и черновик поверх публикации | пустая страница, правка в проде | RPC `cms_save_page`, `draft_snapshot` | M | Высокий | — | Нет |
| A13 | Отложенная публикация | нельзя «в 09:00» | `publish_at` + cron | S | Низкий | A12 | Нет |
| A14 | Теги, категории, bulk в CMS | навигация по контенту | справочник, массовые действия | S | Низкий | — | Частично |
| A15 | Rollup-аналитика | главная тормозит | `daily_activity` + ночной cron | M | Высокий | — | Нет |
| A16 | DAU/WAU/MAU и когорты | нет истории и удержания | графики на rollup | M | Высокий | A15 | Частично |
| A17 | Activation и Free→Pro | нет ключевых метрик | определение активации, события тарифа | S | Высокий | вопрос владельцу | Нет |
| A18 | Материализованные CRM-факты | список не масштабируется | `user_crm_facts` + trigram | M | Высокий | — | Нет |
| A19 | Защита от row-cap | урезанные данные | пагинация и RPC-агрегаты; проверить `max_rows` | S | Высокий | — | Нет |
| A20 | Фоновый экспорт с аудитом | таймаут, утечка без следа | job, ссылка, журнал, колонки, XLSX | M | Средний | — | Частично |
| A21 | Импорт CSV | нельзя загрузить базу | мастер с дедупом | M | Средний | A22 | Нет |
| A22 | Слияние дубликатов | дубли только видны | merge | L | Средний | — | Частично |
| A23 | Правила-автоматизации | всё вручную | «если сегмент N дней → письмо/задача/Telegram» | L | Высокий | A4 | Нет |
| A24 | Редактор шаблонов писем | правки через разработчика | шаблоны в БД, переменные, предпросмотр | M | Средний | — | Нет |
| A25 | Экран интеграций | статусы спрятаны в env | статус, последняя ошибка, тест | S | Средний | `system/health` | Частично |
| A26 | Автоочистка событий и алерты безопасности | retention не работает, алертов нет | cron `purge-events`; Telegram-алерты | S | Средний | — | Частично |
| A27 | Undo и сохранённые представления | нет отката | тост «Отменить» 10 с, сохранённые фильтры | S | Средний | — | Нет |

## 7. Вопросы к владельцу

1. Можно ли применить миграцию 059 к проду сейчас?
2. Кто пользуется legacy `/admin` и `/api/v1/admin`? Удаляем или переводим на GIGA?
3. Включаем `staff_require_mfa` для всех? Нужен ли TOTP-повтор для purge, экспорта и смены ролей?
4. Должен ли журнал хранить email и имя удалённого бессрочно? Что делать с копиями в Resend, Google Sheets и Telegram?
5. Эксперты — это персонал или отдельная роль клиента? Видят только назначенных?
6. Какое событие считаем активацией? Что считаем конверсией в Pro, пока оплата — заглушка?
7. Что кроме ИИ-инсайтов нужно модерировать? Видит ли клиент причину отклонения?
8. CMS: нужна цепочка «редактор → публикатор» или хватит черновика поверх публикации?
9. Какой рост ожидается за 6–12 месяцев?
10. Настроен ли Upstash в проде?
11. Owner-CRM (`crm_reminders`) и GIGA `staff_tasks` — объединяем или это разные продукты?
