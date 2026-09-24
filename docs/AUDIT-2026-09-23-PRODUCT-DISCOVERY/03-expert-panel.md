# 03 · Аудит экспертной части

> Product discovery 2026-09-23. Аудит только по коду, без изменений. Статусы: EXISTING / IMPROVEMENT / MISSING / UNCLEAR.
> Идеи здесь — черновые; сводный backlog с ID — в [00-summary.md](00-summary.md).

Главный вывод: у эксперта нет рабочего места. Есть два не связанных кабинета, в каждом половина инструментов, а в экспертном портале часть данных выдумана.

## 1. Карта экспертной части

### 1.1 Два понятия «эксперт», которые не пересекаются

| | **Эксперт-портал** (`profiles.role='expert'`) | **SuperExpert-кабинет** (`staff_roles.role='super_expert'`) |
|---|---|---|
| Вход | обычный Supabase-логин → `/expert/dashboard` | `/super-expert/login` |
| Проверка прав | `requireExpert()` (`lib/expert-auth.ts:9`): `expert`, `admin`, `super_admin` | `requireGiga(req, permission)` + `ROLE_PERMISSIONS.super_expert` (`lib/admin/rbac.ts:88`) |
| Экраны | `app/(expert)/expert/{dashboard,clients,clients/[id],gri,reports,insights,profile}` | `app/super-expert/(workspace)/{page,users,users/[id],requests,accounts,surveys,gri,activity,invites,duplicates}` — те же экраны GIGA-CRM (`components/giga-panel/pages/*` через `WorkspaceContext`) |
| API | `app/api/expert/**`, `/api/v1/gri/expert-notes`, `/api/export/report`, `/api/share`, `/api/gri/baseline` | `app/api/giga-admin/**` |
| Что пишет | `expert_comments`, `expert_cases` (статус/приоритет), `point_b_versions`, `survey_answers` (`gri_expert_*`) | `user_notes`, `user_assignments`, `staff_tasks`, правка анкеты и компании |
| Видит | Анкета, Дашборд, Точка А, Точка Б, GRI, Pulse, Кейсы, Комментарии | Профиль, Анкета, GRI, Активность, CJM, Документы, Заметки, Задачи, Письма, Качество данных |
| Не видит | заметки, задачи, ответственного, письма, активность, CJM | Точку А, Точку Б, комментарии экспертов, кейсы эскалации, Pulse |

Перекрёстных ссылок между кабинетами в коде нет (`grep expert_comments|expert_cases` по `components/giga-panel` и `app/api/giga-admin` пуст, как и `grep user_notes` по `components/expert` и `app/api/expert`). Получается **два CRM с разными заметками**. Третье хранилище заметок — GRI-заметки в `survey_answers` с `question_key='gri_expert_<block>'` (`app/api/v1/gri/expert-notes/route.ts:43,90`).

### 1.2 Таблицы

| Таблица | Назначение | Кто пишет |
|---|---|---|
| `expert_comments` (005) | комментарии к блокам кабинета, клиент их видит | эксперт-портал |
| `expert_cases` (032) | эскалации от Smart Assistant | создаёт `lib/assistant/escalation/internal-adapter.ts`, правит эксперт-портал |
| `point_b_versions` | экспертная версия Точки Б | эксперт-портал, сразу с `is_approved: true` |
| `user_notes`, `user_assignments`, `staff_tasks` (082) | заметки, ответственный, задачи | только GIGA/SuperExpert, RLS без политик (только service_role) |
| `action_items` (030/057) | план роста клиента | клиент. У экспертов RLS `for all` на **любого** клиента (`030_action_items.sql:36-40`), но в экспертном UI плана нет |
| `growth_bundles` (010) | медицинский модуль | к экспертному workflow не подключено |
| `point_a_insights` (024) | есть тип автора `expert` | отдельного инструмента ответа в экспертном UI нет |

### 1.3 Роли персонала

`STAFF_ROLES` (`rbac.ts:10`): `super_admin`, `admin`, `super_expert` (ранг 60), `crm_manager` (50), `content_manager`, `analyst`, `support`.
`middleware.ts:106-108` через `normalizeRole` превращает `manager`/`analyst` в `expert`. Такие пользователи видят оболочку эксперт-портала, но каждый `/api/expert/*` отвечает 403 (их нет в `EXPERT_ROLES`).

## 2. Рабочий день эксперта по шагам

1. **Получил клиента или задачу.** В портале назначения нет: `/api/expert/clients` (`route.ts:64-66`) отдаёт **всех** `role=client` без пагинации. Задач нет. Кейсы эскалации видны только в карточке конкретного клиента. О новом кейсе сообщает `notifyAdmins` (`internal-adapter.ts:118`), самому эксперту не приходит ничего. В SuperExpert ответственный назначается во вкладке «Задачи» User 360, но в `UsersPage.tsx` нет ни колонки, ни фильтра «ответственный», а общего списка «мои задачи» тоже нет (`app/api/giga-admin/tasks/` содержит только `[taskId]`). **Итог:** 0 сигналов о новой работе.
2. **Понял контекст.** Карточка клиента в портале загружает **всех клиентов**, чтобы найти одного (`clients/[id]/page.tsx:88-91`), и делает 5–7 запросов на 7 вкладок. Нет ни сводки «что изменилось», ни истории взаимодействий. Контекст подменяется выдуманными данными (см. К-5).
3. **Выполнил работу.** Комментарии к блокам (`Commentable` + `CommentComposer`) — сильная сторона. Экспертная Точка Б — только свободный текст `expert_notes`: правки roadmap в UI нет, хотя API принимает `roadmap` (`point-b-version/route.ts:47`). `action_items` эксперт в UI не видит. Нет шаблонов и AI-черновиков.
4. **Дал обратную связь.** Каждый комментарий сразу шлёт клиенту `notifyUser(... 'expert_comment')` (`comments/route.ts:236`): десять комментариев подряд — десять уведомлений. Точка Б сохраняется сразу с `is_approved: true` (`point-b-version/route.ts:61`).
5. **Назначил следующие действия.** В портале назначить нечего. В SuperExpert есть `staff_tasks`, но это задача для персонала, не связанная с планом клиента.
6. **Отследил прогресс.** Нигде нет вида «прогресс клиента по плану» (`action_items.status`). Тренд GRI есть только в CRM. Напоминаний по `due_at` нет.
7. **Вернулся к клиенту.** Триггеров вроде «клиент обновил анкету» или «клиент ответил» для эксперта нет. Колокольчик (`ExpertHeader.tsx:36`) ведёт в клиентский `/notifications`.

**Итого на одного клиента:** примерно 15–25 кликов, 2 кабинета, 0 проактивных сигналов, 3 места для заметок, 0 задач в экспертном портале.

## 3. Таблица аудита

| Возможность | Статус | Доказательство |
|---|---|---|
| Дашборд эксперта | IMPROVEMENT | 4 KPI по всем клиентам; «Мои комментарии» считает **все** комментарии (`dashboard/page.tsx:61`); «GRI < 40» на деле берёт `overall_score` Точки А (`:67-69`) |
| Список клиентов | IMPROVEMENT | только текстовый поиск (`clients/page.tsx:129-140`), без пагинации, фильтров и сортировки |
| Карточка клиента | EXISTING / IMPROVEMENT | 7 вкладок; загружает весь список ради одного клиента (`:88`) |
| История взаимодействий | MISSING (портал) / частично в CRM | «История» скрыта для super_expert (`User360Page.tsx:107`) |
| Задачи | MISSING (портал) / EXISTING в CRM, только по клиенту | `users/[id]/tasks/route.ts` |
| Дедлайны | частично | `staff_tasks.due_at`, `action_items.due_date` — без напоминаний |
| Календарь, расписание | MISSING | — |
| Заметки | ДУБЛИРОВАНИЕ | `expert_comments`, `user_notes`, `gri_expert_*` |
| Обратная связь клиенту | EXISTING | без черновиков и пакетной отправки |
| Рекомендации | IMPROVEMENT | Точка Б — только текст |
| Шаблоны | MISSING | — |
| Быстрые действия | IMPROVEMENT | на дашборде это просто ссылки (`dashboard/page.tsx:231-234`) |
| Уведомления эксперту | MISSING | `expert_case_created` уходит только админам |
| Приоритеты | частично | только `expert_cases.priority` |
| Статус работы с клиентом | MISSING | — |
| Поиск | IMPROVEMENT | поиск по ответам анкеты есть только в CRM |
| Фильтры, сортировка | MISSING (портал) / EXISTING (CRM) | `UsersPage.tsx:67-71,213` |
| Массовые действия | MISSING (портал) / частично в CRM | только `bulk-remind` |
| Аналитика эксперта, KPI, оценка качества | MISSING | `/expert/insights` — честная заглушка |
| История изменений | частично | `logAudit` пишет, но эксперт журнал не видит |
| Отчёты | **ВЫДУМАННЫЕ ДАННЫЕ** | `expert/reports/page.tsx:5-11` захардкожен; загрузка ничего не загружает |
| Scoping (эксперт видит только своих) | **MISSING** | `/api/expert/clients/route.ts:64-66` |
| Распределение клиентов | MISSING (портал) | `assignment/route.ts:61-62`: ответственным может быть только staff |
| Связь двух моделей эксперта | ДУБЛИРОВАНИЕ | §1.1 |

## 4. Критические находки

- **К-1. Scoping экспертов не исправлен.** `GET /api/expert/clients` отдаёт всех клиентов через service role; `/api/expert/clients/[id]/*` проверяют только роль (`requireExpert`), без связки «эксперт ↔ клиент». Исправление 2026-09-17 касается только `authorizeUserDataRead` (`lib/admin/user-data-access.ts:34-39`).
- **К-2. `/api/expert/clients/[id]/*` не проверяют, что цель — клиент.** Эксперт читает email и диагностику админов и других экспертов (`dashboard/route.ts:55-58`), может создать `point_b_versions`/`expert_comments` на любой аккаунт и отправить ему уведомление (`comments/route.ts:211,236`). `EXPERT_ROLES` продублирован в трёх файлах.
- **К-3. Параметр пути подставляется в PostgREST-запрос без кодирования.** `diagnostics?user_id=eq.${clientId}` (`dashboard:44`, `gri:24`, `pulse:47`, `point-b:66`, `point-b-version:21`), `expert_comments?client_id=eq.${clientId}` (`comments/route.ts:166`). После введения scoping это станет обходом. Нужны UUID-валидация или `encodeURIComponent`.
- **К-4. `action_items`: RLS разрешает эксперту менять план любого клиента** (`030_action_items.sql:36-40`) через anon-клиент, без аудита.
- **К-5. Эксперт видит выдуманные данные.** GRI-вкладка при отсутствии данных подставляет `DEFAULT_SCORES` (5/4/3/6/2/5/4) и читает `diagnostics.ai_analysis.gri` вместо `gri_assessments` (`app/api/expert/clients/[id]/gri/route.ts:27-31`). Pulse выдаёт `100 − overall_score` за «риск», а дату диагностики — за «последний заказ» (`pulse/route.ts:63-75`). `/expert/reports` целиком захардкожен. `/expert/gri` показывает GRI самого эксперта (`gri/page.tsx:57`). **Риск: рекомендация клиенту по несуществующим цифрам.**
- **К-6. Экспертная Точка Б публикуется без ревью** (`is_approved: true`, `point-b-version/route.ts:61`), а `author_name = email эксперта` уходит клиенту.
- **К-7. Эскалации не доходят до экспертов.** Уведомляются только админы; `assigned_to` — свободная строка (`expert-cases/route.ts:112-114`); общей очереди кейсов нет.
- **К-8. Две модели эксперта нельзя свести.** Эксперта из портала нельзя назначить ответственным; SuperExpert не видит комментарии, Точку Б и кейсы. `ExpertNotesPanel` (`components/gri/ExpertNotesPanel.tsx:18`) считает экспертами `manager`/`analyst`, но **не** `expert`.
- **К-9. Производительность.** Список и карточка без пагинации грузят всех клиентов, их диагностики и все комментарии.

## 5. Что ускорит работу эксперта

1. Один кабинет: эксперт как staff-роль в RBAC со scoping; Точка А/Б, Pulse, комментарии и кейсы — вкладки User 360.
2. Scoping через существующий `user_assignments`.
3. Очередь «Мой день»: задачи, открытые кейсы, изменения у клиентов.
4. Убрать выдуманные данные (К-5).
5. Черновик разбора и одна публикация.
6. AI-черновики разбора: анкета, Точка А, `gri_assessments.top_5_limits` и Точка Б уже есть в базе.

## 6. Идеи (черновые, сводный список в 00-summary)

| # | Idea | Problem | Solution | Complexity | Impact | Dependencies | Existing? |
|---|---|---|---|---|---|---|---|
| E1 | Scoping по назначению | эксперт видит всех (К-1) | фильтр `/api/expert/*` по `user_assignments.assignee_id`, UUID-валидация, проверка `role=client` | M | High | модель ролей | IMPROVEMENT |
| E2 | Единая роль эксперта в RBAC | два кабинета (К-8) | роль `expert` в `STAFF_ROLES`, портал на `giga-panel/pages` | L | High | E1 | MISSING |
| E3 | Точка А/Б, Pulse, Кейсы, Комментарии в User 360 | SuperExpert их не видит | перенести `components/expert/tabs/*` в `user360` | M | High | E2 | IMPROVEMENT |
| E4 | «Мой день» | нет сигнала о работе | `GET /api/expert/today` | M | High | E1 | MISSING |
| E5 | Общий список «Мои задачи» | задачи видны только по клиенту | `GET /api/giga-admin/tasks?assignee=me` + страница | S | High | — | MISSING |
| E6 | Колонка и фильтр «Ответственный» | не видно «моих» клиентов | `assignee` в `admin_list_users` и `UsersPage` | S | Med | — | MISSING |
| E7 | Очередь эскалаций | кейсы только в карточке | страница «Кейсы», уведомление ответственному, FK `assigned_to` | M | High | E1 | IMPROVEMENT |
| E8 | Честные GRI и Pulse | выдуманные данные (К-5) | читать `gri_assessments`; пустое состояние | S | High | — | IMPROVEMENT |
| E9 | Реальные «Отчёты» | мок-страница | история PDF по моим клиентам | M | Med | E1 | IMPROVEMENT |
| E10 | Черновик разбора и одна публикация | уведомление на каждый комментарий | `draft/published`, одно письмо | M | High | — | MISSING |
| E11 | Ревью Точки Б старшим | публикация без проверки (К-6) | `is_approved=false`, одобряет super_expert | S | Med | E10 | IMPROVEMENT |
| E12 | Библиотека шаблонов рекомендаций | всё с нуля | `expert_templates` + вставка в Composer | S | Med | — | MISSING |
| E13 | AI-черновик разбора | ручной анализ 7 вкладок | OpenRouter → черновик комментариев по блокам | M | High | E10 | MISSING |
| E14 | AI-сводка «что изменилось» | неясно, что нового | diff с `expert_last_seen` + резюме | M | High | E4 | MISSING |
| E15 | AI «вопросы клиенту» | пробелы в данных ищутся вручную | из `quality` + `data_gaps` → вопросы одним письмом | S | Med | CRM quality | IMPROVEMENT |
| E16 | План клиента в экспертном UI | `action_items` недоступны (К-4) | вкладка «План» через API с аудитом, закрыть RLS | M | High | E1 | MISSING |
| E17 | Статус работы с клиентом | не видно этапа | `expert_stage` | S | Med | — | MISSING |
| E18 | Напоминания по дедлайнам | `due_at` ничего не делает | крон → email/Telegram | S | Med | E5 | MISSING |
| E19 | Триггеры возврата к клиенту | эксперт не знает, когда вернуться | событие → уведомление ответственному | M | High | E1 | MISSING |
| E20 | Ответы клиента в треде | обратная связь в одну сторону | `parent_id` у `expert_comments` | M | Med | E19 | MISSING |
| E21 | KPI эксперта | нет метрик работы | время ответа, число разборов, рост GRI подопечных | M | Med | E1, E7 | MISSING |
| E22 | Оценка разбора клиентом | качество не измеряется | 1–5 + комментарий | S | Med | E10 | MISSING |
| E23 | Балансировка распределения | ручное назначение | авто-распределение и массовое переназначение | M | Med | E6 | MISSING |
| E24 | Календарь сессий | нет расписания | `expert_sessions` + ICS | M | Med | E5 | MISSING |
| E25 | Быстрые действия в списке | всё через карточку | действия в строке | S | Med | E5 | IMPROVEMENT |

## 7. Вопросы к владельцу

1. Какая модель эксперта целевая: `profiles.role='expert'` (портал) или staff-роль в RBAC? Сливаем портал в workspace на `giga-panel/pages`?
2. Scoping: рядовой эксперт видит только назначенных, а super_expert/admin/crm_manager — всех? Кто назначает?
3. Публичные комментарии и внутренние заметки: держим в одном интерфейсе? Переносим GRI-заметки из `survey_answers`?
4. Нужна ли ревизия Точки Б старшим экспертом? Можно ли показывать клиенту email эксперта?
5. Кому уходит новый `expert_case`, какой SLA?
6. Может ли эксперт править план клиента или только предлагать изменения?
7. Используются ли ещё роли `manager`/`analyst` в `profiles`?
8. `/expert/reports` и `/expert/gri`: удалить, заменить реальными данными или скрыть?
9. Какие KPI эксперта важны бизнесу?
10. Нужны ли календарь и сессии внутри платформы?
