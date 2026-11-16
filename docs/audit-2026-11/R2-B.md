# R2-B — работа экспертов с SLA (24 ч реакция / 48 ч ответ)

Ветка `claude/round2-paywall-experts`, worktree `multi-agent-portal-dev-8f4869`. Ничего не закоммичено, не запушено, к staging/проду ничего не применялось. Миграция 145 проверена только на локальной тест-БД (127.0.0.1:54329).

Решение PO: экспертов 1–2; эксперт отвечает клиенту за 48 ч; если за 24 ч нет реакции — эскалация. Теперь это работающий механизм, а не обещание в тексте.

---

## 1. Аудит «как было»

### Откуда приходила работа эксперту

| Источник | Как поступало | Срок и время | Кто получал |
|---|---|---|---|
| `expert_cases`: эскалации ассистента (`/api/v1/assistant/escalate`, `ask`), заявка бота «Сообщения» (`lib/comm/bot.ts createCommCase`), личный Telegram-sync, ручные | внутренний адаптер `lib/assistant/escalation/internal-adapter.ts` (service role) | `sla_due_at` по приоритету (088: critical 2 / high 4 / medium 24 / **low 72 ч**), `first_response_at` | `assignee_id` = ответственный клиента (`user_assignments`), иначе никто; `notifyAdmins` один раз при создании |
| `report_versions` в статусе `in_review` (103) | агент `report` после диагностики | срока не было | экспертный бот уведомляет экспертов клиента; кабинет `/expert/reports`, SuperExpert `/super-expert/reports` |
| `pb_recommendations` `pending_review` (129) | правила / ИИ Точки Б | срока не было; клиенту показывается «N рекомендаций на проверке у эксперта» | никого не уведомляли |
| `pb_plan_versions` `in_review` (125) | эксперт отправил план | срока не было | Admin / Super Admin (очередь «Точка Б — на одобрении», `notifyPlanSubmitted`) |
| «Позвать эксперта» из беседы анкеты | `/api/v1/survey/chat/escalate` → диалог «Сообщения» | своё «правило 30 минут» (`lib/comm/escalation.ts`) | персонал с `inbox.manage` — не эксперты |

### Где задачи терялись

1. **Экспертов (profiles.role = 'expert') нельзя было назначить ни клиенту, ни кейсу через ГИГА.** Все пути назначения (`setClientAssignment`, массовое `validateAssignee`, `PATCH /api/giga-admin/cases/:id`) принимали только людей со строкой в `staff_roles`, а эксперты по D1 в `staff_roles` не входят. После Раунда 1 эксперт видит только назначенных клиентов (правило 140), поэтому без назначения эксперт не видел работы вообще.
2. Клиент без ответственного → кейс без исполнителя. Отчёты на проверке таких клиентов видели только сотрудники со скоупом «все». Получатель не был определён (открытый вопрос аудита).
3. **Не было часов.** Ни крон, ни Inngest не следили за `sla_due_at`. Просроченное видел только тот, кто сам открывал «Эскалации». У отчётов, рекомендаций и планов срока не было совсем.
4. Реакция эксперта из его кабинета (`PATCH /api/expert/clients/:id/expert-cases`) не записывала `first_response_at`: её писала только ГИГА.
5. Клиенту говорили «эксперт свяжется с вами, как только освободится». Конкретного срока не было, и бот говорил это ещё до того, как заявка была записана.

### Что из SLA уже было
- 088: `expert_cases.assignee_id / sla_due_at / first_response_at`, очередь «Эскалации» с отметкой «просрочено», `computeSlaDueAt` и `slaState` (`lib/admin/escalations.ts`).
- Модуль «Эксперты» в ГИГА показывал нагрузку, но только для **SuperExpert** (`staff_roles`).
- «Правило 30 минут» для «Сообщений» с паттерном захвата `escalated_at` (взят как образец идемпотентности).

---

## 2. Что сделано

### Модель
Одна таблица-реестр **`expert_sla_tasks`** (миграция 145). Одна строка = одна единица работы эксперта с часами:
- источники: `case` (открытые `expert_cases`), `report_review` (`report_versions in_review`), `rec_review` (рекомендации компании на проверке — одна задача на компанию), `plan_review` (план Точки Б на одобрении — Admin / Super Admin);
- поступление `received_at`, срок реакции `reaction_due_at` = +24 ч, срок ответа `answer_due_at` = +48 ч, реакция `first_response_at`, закрытие `closed_at`, пороги `escalated_at` / `breached_at`;
- **реакция** — кейс ушёл из «новых», проверена хоть одна рекомендация, принято решение по отчёту или плану; **ответ** — кейс решён или закрыт, отчёт опубликован или отправлен на правки, рекомендаций на проверке не осталось, план одобрен или возвращён;
- часы SLA стартуют в момент применения миграции (`system_settings.expert_sla_clock_start`). Работа, поступившая раньше, считается с этого момента, поэтому бэклог не превращается в лавину просрочек.

### Назначение (п. 1 ТЗ)
1. У кейса уже есть исполнитель, или у клиента есть ответственный, и он может вести экспертную работу (одобренный эксперт / staff super_admin, admin, super_expert) — исполнителем становится он.
2. У клиента **нет** ответственного и включено «Назначать автоматически» — работа уходит **наименее загруженному** эксперту: меньше открытых задач → меньше клиентов → кто дольше ждал назначения (по очереди) → по id. Эксперт становится ответственным клиента (иначе по правилу 140 он не увидит его данных). Существующего ответственного механизм никогда не перезаписывает.
3. Иначе (ответственный — не эксперт, например CRM-менеджер; экспертов нет; авто выключено) — **общая очередь + уведомление SuperExpert** (если SuperExpert нет — Admin). Это решение по умолчанию для открытого вопроса аудита (п. 4 ТЗ).
4. Ручное переназначение в ГИГА «SLA экспертов» (Admin / Super Admin / SuperExpert, права `clients.review` + `users.sensitive`, только видимые по скоупу задачи). Новый исполнитель становится ответственным клиента; все открытые задачи и обращения клиента переходят к нему. Есть журнал аудита и уведомление.
5. План Точки Б эксперту не назначается: его одобряют Admin / Super Admin.

### Часы и уведомления (п. 2, 5 ТЗ)
- Inngest `expert-sla-watch`, cron `*/5`, `concurrency 1`, `retries 0`, `timeouts {start 4m, finish 2m}`, бюджет прохода 30 с, без LLM.
- Проход (`lib/expert-sla/run.ts`): RPC `expert_sla_sync` (закрыть выполненное, отметить реакции, перенести переназначенный кейс, открыть новые задачи) → авто-назначение → RPC `expert_sla_claim('breached')` → `expert_sla_claim('escalated')`.
- **Идемпотентность в базе:** `expert_sla_claim` — `UPDATE … WHERE escalated_at/breached_at IS NULL` с `FOR UPDATE SKIP LOCKED`, каждая задача достаётся ровно одному вызову. Ключ `dedupe_key` ленты — `expert_sla.<порог>:<id>`. Просрочка заодно ставит `escalated_at`, так что у бэклога одно сообщение, а не два.
- Каналы — только существующие:
  - `notifyStaff` (лента ГИГА + Telegram / WhatsApp сотрудникам по их правилам), адресаты SuperExpert + Admin / Super Admin + исполнитель. 24 ч — `WARNING`, 48 ч — `CRITICAL` (ещё и письмо `ADMIN_NOTIFICATION_EMAIL`);
  - исполнителю: его лента (`createNotification`) и экспертный Telegram-бот, если он привязан;
  - больше 5 задач за проход — одна сводка.

### Видимость (п. 3 ТЗ)
- **Кабинет эксперта:** новый пункт «Очередь» (`/expert/queue`) и панель «Очередь задач» на дашборде. Таймер «осталось N ч» / «просрочено на N ч» с цветом состояния, обновляется раз в минуту. Видны только назначенные эксперту задачи и задачи его клиентов.
- **ГИГА и кабинет SuperExpert:** раздел «SLA экспертов». Плитки «Открыто / Скоро срок (≤ 6 ч) / Нет реакции 24 ч / Просрочено 48 ч / Без исполнителя», вкладки «Требуют внимания / Просрочено / Без исполнителя / Мои / Все открытые / Закрытые», переназначение и «Взять себе».
- **Настройки ГИГА:** панель «SLA экспертов» — включение, часы реакции и ответа, авто-назначение. Новая настройка реестра `expert_sla`, по умолчанию `{enabled: true, reaction_hours: 24, answer_hours: 48, auto_assign: true}`.
- **Клиент:**
  - бот «Сообщения» теперь **сначала записывает заявку, потом отвечает**. «Оформил заявку. Эксперт ответит в течение 48 часов.» — только если заявка реально создана и SLA включено; иначе прежний текст;
  - `GET /api/v1/expert-sla` — открытые задачи самого клиента (под его сессией, RLS) и честное `promise`, только когда задача в очереди.

### Попутные исправления
- Одобренного эксперта теперь можно назначить ответственным клиента и исполнителем кейса через API: `setClientAssignment`, массовое назначение, `PATCH cases/:id`. Помощник `isAssignableResponsible`: любой staff (как было) **или** одобренный эксперт.
- Кабинет эксперта записывает первую реакцию (`first_response_at`), когда кейс уходит из «новых».

### Файлы
**Новые**
- `supabase/migrations/145_expert_sla_tasks.sql`, `supabase/migrations/rollback/145_expert_sla_tasks.down.sql`
- `lib/expert-sla/policy.ts` (сроки, состояние, таймер, текст клиенту), `assign.ts`, `notify.ts`, `run.ts`, `store.ts`, `links.ts`
- `lib/functions/expert-sla.ts` (Inngest)
- API: `app/api/giga-admin/expert-sla/route.ts`, `…/[id]/route.ts`, `…/assignees/route.ts`, `app/api/expert/sla-tasks/route.ts`, `app/api/v1/expert-sla/route.ts`
- UI: `components/giga-panel/pages/ExpertSlaPage.tsx`, `app/admin-giga-panel/expert-sla/page.tsx`, `app/super-expert/(workspace)/expert-sla/page.tsx`, `components/expert-sla/ExpertSlaQueueList.tsx`, `components/expert-sla/ExpertQueuePanel.tsx`, `app/(expert)/expert/queue/page.tsx`
- Тесты: `tests/integration/db/expert-sla.test.ts`, `tests/unit/expert-sla/{_fake,policy,assign,run,notify,store,routes,queue-ui}.test.ts`

**Изменённые (минимально, общие файлы перечитаны перед правкой)**
- `lib/settings/registry.ts` (+13: ключ `expert_sla`)
- `lib/functions/registry.ts` (+3, функция в конце списка) и `tests/unit/functions/registry.test.ts` (+1)
- `lib/admin/nav.ts` (+3: пункт в ГИГА и SuperExpert)
- `tests/contracts/route-auth.manifest.ts` (+5 маршрутов)
- `lib/admin/client-actions.ts`, `lib/admin/bulk-users.ts`, `app/api/giga-admin/cases/[id]/route.ts` (эксперт как ответственный)
- `app/api/expert/clients/[id]/expert-cases/route.ts` (`first_response_at`)
- `components/layout/ExpertSidebar.tsx` (+1), `app/(expert)/expert/dashboard/page.tsx` (+4)
- `app/admin-giga-panel/settings/page.tsx` (+27: панель «SLA экспертов»)
- `lib/comm/bot.ts`, `lib/comm/bot-rules.ts`, `tests/unit/comm/bot.test.ts` (обещание срока после записи заявки)

Область R2-A (`lib/access/*`, `/api/v1/access/me`, пейволл) не тронута. Маскот «Гри» не тронут.

---

## 3. Тесты и результат

Новые тесты — **57**, все зелёные:

| Файл | Тестов | Что проверено |
|---|---|---|
| `tests/integration/db/expert-sla.test.ts` (реальная БД, откат транзакции) | 10 | задача на каждый из 4 источников; исполнитель из кейса / ответственного-эксперта; CRM-менеджер и неодобренный эксперт → очередь; **пороги с подменой времени**: 23,9 ч → нет, 24,1 ч → эскалация, повтор → пусто; 47,9 ч → нет, 48,5 ч → просрочка, повтор → пусто; бэклог: просрочка закрывает эскалацию; реакция до 24 ч отменяет эскалацию; ответ закрывает задачу и останавливает просрочку; закрытие отчёта / рекомендаций / плана; старт часов и повторно открытый кейс; переназначение кейса; **RLS**: эксперт — только своё и своих клиентов, клиент — только своё, SuperExpert «только назначенные» — по скоупу, admin — всё, anon — 42501, неодобренный эксперт — ничего, запись и вызов функций под authenticated — 42501; `expert_sla_is_worker` |
| `tests/unit/expert-sla/policy.test.ts` | 7 | сроки 24/48, стадии на подменённом времени, таймер «осталось 31 ч / 30 мин / просрочено на 5 ч», формы «часа/часов», валидация настройки |
| `assign.test.ts` | 7 | наименее загруженный, ничьи, по очереди e1→e2→e1→e2; кто может вести работу; ответственный не перезаписывается; нагрузка кандидатов |
| `run.test.ts` | 7 | авто-назначение, очередь, план не в экспертной очереди; **идемпотентность прохода** (повтор и ретрай не шлют дублей); авто выключено; нет экспертов; SLA выключено; бюджет; ошибка sync не глотается |
| `notify.test.ts` | 5 | WARNING / CRITICAL, адресаты (SuperExpert + Admin + исполнитель, без CRM и заблокированных), ключи дедупликации, сводка > 5, очередь → SuperExpert, сбой канала не роняет проход |
| `store.test.ts` | 7 | видимость, виды очереди и сводка, порядок по срочности, без email, переназначение и отказы |
| `routes.test.ts` | 9 | **права**: ГИГА (CRM / support / analyst → 403, скоуп SuperExpert), PATCH (чужой скоуп 403, не-исполнитель 400, без прав 403, аудит + уведомление), эксперт — только своё, клиент — только своё + обещание, SLA выкл → без обещания, без сессии → 401 |
| `queue-ui.test.ts` | 4 | **UI таймера** (renderToStaticMarkup): «осталось N ч», стадия, «просрочено», ссылки, пустое состояние |
| `tests/unit/comm/bot.test.ts` | +1 | обещание «48 часов» только при созданной заявке |

Проверки:
- **Полный прогон** `~/.a360-test/vt.sh --reporter=dot`: файлов 775 — 770 passed, 2 failed, 3 skipped; тестов 8510 passed, **2 failed**, 14 skipped. Оба падения — известные тесты моста WhatsApp (`Cannot find package 'baileys'`): `whatsapp-web-bridge-pull-control`, `whatsapp-web-bridge-reliability`.
- **tsc** (`NODE_OPTIONS=--max-old-space-size=5120 npx tsc --noEmit`): 0 ошибок.
- **lint** (`npm run lint`): 0 предупреждений и ошибок.
- **Миграция на тест-БД:** применена повторно дважды (идемпотентна). Откат `145_….down.sql` проверен в транзакции: таблица, функции и `clock_start` удаляются, повторное применение после отката работает.

Прогоны шли при параллельных изменениях R2-A в том же worktree; цифры — состояние на момент прогона.

---

## 4. Не сделано / предложения
- **Миграция 145 не применена к staging/проду.** Применять после 140 и 143 (миграция сама проверяет, что `staff_session_ok()` существует). После деплоя нужен **resync Inngest** (`PUT /api/inngest`), иначе `expert-sla-watch` не зарегистрируется.
- Выпадающие списки ответственных в ГИГА («Пользователи», «Эскалации», «Задачи» — общий `/api/giga-admin/staff/list`) по-прежнему показывают только `staff_roles`. Эксперта теперь принимает API, но выбрать его можно только в «SLA экспертов». Предлагаю добавить экспертов в справочник и модуль «Эксперты» (сейчас там только SuperExpert) — общие компоненты, отдельной задачей.
- Нет бейджа-счётчика «SLA экспертов» в меню ГИГА (тип `GigaNavBadge` + сайдбар — общие файлы).
- Кнопка «Позвать эксперта» в чате Гри (`components/assistant/AssistantChatPanel.tsx`) по-прежнему говорит «эксперт свяжется с вами» — не менял по правилу «Гри не трогать». API `/api/v1/expert-sla` готов для честного текста.
- Обещание срока клиенту показано только в боте «Сообщения». Виджет в кабинете клиента не ставил: там пейволл R2-A.
- Текст бота «Позову эксперта — он ответит, как только освободится» (handoff в живой диалог) оставлен: там действует своё «правило 30 минут». Заявка при этом тоже ставится в очередь с 48 ч.
- Уведомление после захвата порога не повторяется при сбое канала (как у «30 минут»). Факт виден в ГИГА («уведомлены / эскалация отправлена»).
- Срок считается календарными часами 24/7, без рабочего времени.

## 5. Вопросы к PO
1. **Кто получает работу клиента без эксперта** (вопрос аудита). Реализовано: авто-назначение наименее загруженному эксперту включено; при отсутствии экспертов — общая очередь + SuperExpert. Авто-назначение **делает эксперта ответственным клиента** (иначе по правилу 140 он не видит данных). Оставляем включённым или по умолчанию только очередь (тумблер в Настройках)?
2. **Что считать «ответом за 48 ч»:** сейчас это закрытие (кейс решён, отчёт опубликован или отправлен на правки, рекомендации проверены, план решён). Взятие в работу — только «реакция» (24 ч). Устраивает?
3. В «Эскалациях» остаются старые сроки реакции по приоритету (critical 2 / high 4 / medium 24 / **low 72 ч**). 72 ч противоречит правилу «24 ч». Выровнять low до 24 ч или убрать приоритетный SLA в пользу единого?
4. **Бэклог при включении:** часы стартуют с момента применения миграции, у старых открытых задач первая эскалация будет через 24 ч. Или считать от реального возраста (сразу пачка просрочек — одной сводкой)?
5. Под тот же SLA попали **рекомендации Точки Б** (создаются автоматически, их много) и **одобрение плана** Admin / Super Admin. Оставляем оба источника?
6. Считать SLA календарными часами или рабочими (Алматы, будни)?
7. Менять ли текст Гри «эксперт свяжется с вами» на «ответит в течение 48 часов» (нужно разрешение трогать Гри)?

---

## 6. Исправления по ревью (`R2-B-REVIEW.md`, задание оркестратора, пп. 1–10)

Работа поверх коммита 4792f703. Ничего не закоммичено. К staging/проду ничего не применялось. Область пейволла (`lib/access/*` и т. п.) не тронута.

### Что изменено (файлы)
**Новые:**
- `supabase/migrations/146_expert_sla_hardening.sql` — идемпотентная, `lock_timeout 5s`, проверяет наличие 145;
- `supabase/migrations/rollback/146_expert_sla_hardening.down.sql` — восстанавливает состояние 145 целиком: политики, тела `expert_sla_sync` / `expert_sla_claim` из 145, удаление колонок, триггеров и функций 146.

**Изменённые:**
- `lib/expert-sla/policy.ts`, `assign.ts`, `notify.ts` (переписан), `run.ts` (переписан), `store.ts`;
- маршруты `app/api/giga-admin/expert-sla/route.ts`, `…/[id]/route.ts`, `app/api/expert/sla-tasks/route.ts`, `app/api/v1/expert-sla/route.ts`;
- `lib/comm/bot.ts` (только SLA-часть), `lib/comm/bot-rules.ts`, `components/giga-panel/pages/ExpertSlaPage.tsx`;
- тесты: `tests/unit/expert-sla/{_fake,run,notify,store,routes}.test.ts`, `tests/unit/comm/bot.test.ts`, `tests/integration/db/expert-sla.test.ts`.

### Что изменено в БД (миграция 146)
- **`expert_cases_insert_own` ЗАМЕНЕНА** (то же имя, строже, не удалена без замены).
  - Было: `WITH CHECK (user_id = auth.uid())`.
  - Стало: `user_id = auth.uid() AND status = 'new' AND assignee_id IS NULL AND assigned_to IS NULL AND first_response_at IS NULL AND sla_due_at IS NULL AND comm_thread_id IS NULL`. Колонки берутся по факту наличия.
  - Остальные политики `expert_cases` не тронуты. Приложение пишет через service role — его это не затрагивает.
- **`expert_sla_tasks_staff_select` заменена:** убрана ветка «назначена мне» (`assignee_id = auth.uid() AND is_platform_staff()`). Осталось `staff_sees_all_clients() OR client_id IN staff_assigned_user_ids()`.
- **Новые колонки:** `answered`, `lineage`, `assign_notified_at`, `queue_notified_at`, `escalation_notified_at`, `breach_notified_at`, `notify_attempts`, `info_attempts`, `notify_error`. Бэкфилл выполняется один раз, только при первом добавлении колонок. Добавлен индекс `(source, lineage, closed_at)`.
- **Новые функции** (SECURITY INVOKER, EXECUTE только у service_role):
  - `expert_sla_can_hold(user, client)`;
  - `expert_sla_realign(client|NULL, now)`;
  - `expert_sla_mark_notified(ids[], kind, ok, error, assignee, now)`;
  - триггерные `expert_sla_follow_assignment()` и `expert_sla_tasks_reset_notified()`.
- **Новые триггеры:**
  - `AFTER INSERT / UPDATE OF assignee_id / DELETE ON user_assignments` — выравнивает задачи клиента и переносит его открытые обращения прежнего ответственного новому. Ошибка внутри триггера логируется `WARNING` и не ломает само назначение; следующий проход выровняет повторно;
  - `BEFORE UPDATE ON expert_sla_tasks` — смена исполнителя сбрасывает отметку «уведомлён».
- **`expert_sla_sync` и `expert_sla_claim` пересозданы** (CREATE OR REPLACE с той же сигнатурой).
- **`expert_sla_clock_start`:** запись, сделанная миграцией 145, удаляется, пока задач ещё нет.

### Пункт → изменение → тест → результат

| № | Изменение | Тест (падал бы до исправления) | Результат |
|---|---|---|---|
| 1 | PATCH `/api/giga-admin/expert-sla/:id` требует, чтобы клиент задачи был в скоупе актора (`scopeAllows` — то же правило, что у штатного назначения). То, что актор — исполнитель задачи, доступа не даёт: ни «Взять себе», ни передачи другому. Видимость в ГИГА и в кабинете эксперта — только по скоупу клиента. | `routes.test.ts` «п. 1: «Взять себе» needs the CLIENT in the actor's scope» (SuperExpert со скоупом `[]`, задача на нём → 403, назначений нет; на коде HEAD — 200). Плюс `store.test.ts` «п. 1–2: a scoped actor sees tasks of HIS clients only» | ✓ |
| 2 | Задачи следуют за ответственным клиента. Триггер на `user_assignments` покрывает **все** пути: карточку ГИГА и `setClientAssignment`, массовое назначение, модуль «Эксперты», Telegram-бот, авто-назначение. Плюс `expert_sla_realign` в каждом проходе как страховка (например, заблокированный эксперт → задачи уходят в очередь). Исполнитель-worker → задачи ему, иначе → очередь (с повторным уведомлением SuperExpert). Открытые обращения прежнего ответственного переходят новому. Бывший исполнитель задачу не видит — ни в RLS, ни в очередях. Эскалация уходит текущему исполнителю. | БД: «п. 2: a change of the client's responsible moves open tasks and cases at once; the former expert sees nothing» (UPDATE / INSERT / DELETE, RLS бывшего = 0, эскалация на новом), «п. 2: a blocked expert loses his tasks…». Unit: `routes.test.ts` «an expert sees tasks of his clients only…» | ✓ |
| 3 | Миграция 146 ужесточает клиентскую вставку (см. выше). В sync собственный исполнитель кейса (`own`) принимается, только если он может держать задачу (`expert_sla_can_hold`: ответственный клиента или staff со скоупом «все»). Обращение в «Эскалациях» передаёт задачу тоже только такому человеку. | БД: «п. 3: a client opens a request through PostgREST only with the defaults» (assignee / assigned_to / in_progress / resolved / first_response_at / sla_due_at / чужой user_id → 42501; значения по умолчанию — проходят). «…the case's own assignee only if he may hold it» (эксперт не ответственный → очередь; admin → `source`). «a case re-assigned in «Эскалации» moves its task only to someone who may hold it» | ✓ |
| 4 | Авто-назначение только обычным клиентам: одобренный профиль с клиентской ролью (`client` / `owner` — `lib/profiles/client-roles.ts`), без строки `staff_roles`. Персонал, эксперты, legacy `super_admin`, неодобренные и заблокированные → очередь. На каждое авто-назначение — запись в журнал `admin_audit_log`: `user.assigned`, актор `system:expert-sla`, `metadata.via = expert_sla.auto_assign`. Значение по умолчанию оставлено **включённым**. | `run.test.ts` «п. 4: staff, a legacy super_admin, an expert, a pending or blocked account never get an automatic responsible» и проверка записи аудита в «least loaded expert for plain clients, with an audit entry…» | ✓ |
| 5 | Новые задачи — **одно сообщение на исполнителя**; пороги и очередь — сводкой при > 5. Бюджет (30 с ≤ 45 с) проверяется в каждом цикле. Задачи, до которых бюджет не дошёл, **не уходят в очередь**: авто-назначение каждый проход берёт до 100 старейших неназначенных. Чтения по спискам id — чанками ≤ 100. Убраны `.in('id', newIds)` и `or(client_id.in.(…1000…))` с обрезкой до 1000. | `run.test.ts`: «п. 5: tasks the budget did not reach are NOT queued — the next pass assigns them», «п. 5: reads by id lists go in chunks of ≤ 100 (250 clients)», «more than 5 tasks … → one summary», «one assignment message per assignee». `notify.test.ts` «п. 5: the assignee gets ONE message…». `store.test.ts` «loadSlaTasks reads the scope in chunks of ≤ 100 ids (1150 клиентов)» | ✓ |
| 6 | Outbox. `escalated_at` / `breached_at` означают «захвачено». `*_notified_at` ставится **только после успешной доставки** (`expert_sla_mark_notified`). Успех: событие ленты записано (`notifyStaff` вернул `eventId`) и, если есть исполнитель, создана запись в его ленте. Неудача — +1 к `notify_attempts` (пороги) или `info_attempts` (назначение и очередь), текст ошибки в `notify_error` и в лог; следующий проход повторяет, до 5 попыток. Повтор без дублей: ключ дедупликации ленты, `notifyStaff` дошлёт только тем, кому не дошло. Ошибка чтения адресатов — это неудача, а не «отправлено никому». ГИГА показывает «эскалация ещё не доставлена» и «не доставлено, попыток N». | `run.test.ts` «п. 6: a failed delivery is NOT marked sent — the attempt is counted, the next pass delivers it», «after 5 failed attempts the run stops retrying». `notify.test.ts` «п. 6: an unreadable audience is a failed delivery», «feed event not recorded / assignee's feed not written → ok: false». БД: «п. 6: delivery is recorded only on success…», «the breach claim settles a pending escalation delivery» | ✓ |
| 7 | Часы стартуют на **первом проходе** watcher'а: `expert_sla_sync` пишет `expert_sla_clock_start` (`ON CONFLICT DO NOTHING`, `v_now`). Запись 145 удаляется миграцией 146, пока задач нет. Поздний resync Inngest больше не превращает бэклог в мгновенные просрочки. | БД «п. 7: the clock starts at the watcher's first pass, not at the migration» (первый проход через 72 ч после миграции, кейс возрастом 100 ч → поступление = первый проход, просрочки нет; повторный проход старт часов не двигает) | ✓ |
| 8 | Закрытие без эксперта — `answered = false`. Причины: `superseded` (отчёт заменён без решения), `stale` (рекомендации устарели без проверки), `withdrawn` (план отозван), `failed`, `gone`. Реакция и ответ при этом **не** засчитываются. Новая задача той же линии (отчёт: компания + тип; рекомендации: компания; план: план; кейс: кейс), открытая в пределах окна ответа (48 ч), **наследует** поступление, сроки, реакцию и отметки порогов (повторной эскалации нет). Решение эксперта (опубликован, `changes_requested`, одобрен / отклонён, проверена рекомендация) — ответ, новая версия получает свои часы. | БД: «п. 8: a report replaced without a decision is not an answer; the new version keeps the original clock» (наследование, повторной эскалации нет, просрочка на 48 ч от исходного), «stale recommendations are not «reviewed»; the regenerated ones inherit the clock; an expert decision is an answer», «a predecessor closed … longer ago than the answer window is not inherited» | ✓ |
| 9 | Шаги прохода независимы: сбой sync логируется, о нём уведомляют (не чаще раза в час: `expert_sla.sync_failed`). Захват порогов и доставка по уже открытым задачам продолжаются. Ошибки захвата и чтения outbox тоже не роняют проход. | `run.test.ts` «п. 9: a failed sync does not stop the thresholds of open tasks; staff are told» (на HEAD проход бросал исключение до захвата) | ✓ |
| 10 | Бот: обещание срока — только для **новой** заявки, только если SLA включено **и** таблица `expert_sla_tasks` читается. Повторное обращение по уже открытой заявке — нейтральный текст `CASE_REUSED_TEXT` («Ваша заявка уже у эксперта — ответ придёт в этот диалог.»). Ответ LLM при обещании заменяется стандартным текстом, чтобы не было «как только освободится» рядом с «48 часов». `/api/v1/expert-sla`: обещание только при открытой экспертной работе (не одобрение плана) с ещё не прошедшим сроком; у задач есть флаг `overdue`. | `bot.test.ts`: «R2-B п. 10: a repeated request on the open one gets a neutral text», «the default promise needs the SLA switched on AND the ledger table readable». `routes.test.ts`: «п. 10: no promise for plan approval only … or for an overdue task», «the SLA ledger missing → no promise» | ✓ |

### Доказательство «падал бы до исправления»
- **БД:** миграция 146 откачена на тест-БД (`rollback/146…down.sql`, состояние 145), прогнан блок «146». Упало **8 из 9**; прошёл только охранный тест «предшественник старше окна не наследуется», в 145 наследования не было вовсе. Затем 146 применена снова. Откат и повторное применение отработали без ошибок; миграция применялась дважды подряд — идемпотентна.
- **Unit:** исходники SLA и бота временно заменены версиями из HEAD 4792f703 (скрипт в scratchpad `swap.sh`, затем восстановлены, md5 совпали). Упало **25 из 86**, в том числе все тесты пп. 1, 2, 4, 5, 6, 9, 10. Часть падений — из-за смены интерфейса уведомлений (возврат результата доставки).

### Прогоны
- Точечно, после всех правок (`vt.sh tests/unit/expert-sla tests/integration/db/expert-sla.test.ts tests/unit/comm tests/contracts tests/unit/functions tests/unit/giga-crm tests/integration/db/staff-rls-scope.test.ts`): **689 passed, 1 failed**. Это `comm/bot.test.ts › the prompt carries only this user's data (… Point A)` — его ломает параллельная правка R2-A (ревью L-3) в `lib/comm/bot.ts`: `resolveFeature('point_a')` в фактах бота. В герметичной среде чтение `access_gates` падает (fail closed), и бот скрывает балл Точки А. Мой код эту ветку не трогает.
- **Полный прогон** `vt.sh --reporter=dot`: файлов 776 — 760 passed, 13 failed, 3 skipped; тестов **8519 passed, 37 failed**, 14 skipped.
  - 2 падения — известный мост WhatsApp (нет `baileys`);
  - 35 — в области параллельной незакоммиченной работы R2-A: `access/*`, `point-a/*`, `gri-ai-routes`, `metrics-catalog`, `nba`, `top-table`, `p2-input-hardening`, `golden-surfaces`, указанный тест бота. Везде в логе `[access_gates] read failed — … fail closed`.
  - В тестах SLA экспертов падений нет: 57 unit + 19 БД + 3 теста бота — зелёные.
- **tsc:** 0 ошибок. **lint:** 0.

### Не сделано / оговорки
- Старые обращения, которые клиент создал напрямую **до** 146 со статусом `in_progress` или с реакцией, по-прежнему засчитываются как реакция. Отличить их от настоящих нельзя; новые такие вставки миграция 146 запрещает.
- Экспертный Telegram при эскалации отправляется по возможности: его сбой логируется, но повтора не вызывает. Доставкой считаются лента ГИГА и лента исполнителя.
- Обещание в боте не проверяет «живость» watcher'а (свежесть последнего прохода): проверяются включённость SLA и наличие таблицы, как в задании.
- Из находки 11 ревью: колонки своих строк, видимые клиенту через прямой REST, и открытие при сбое (fail-open) в `lib/admin/actor-scope.ts` (было и раньше) — не менял, предлагаю отдельно.
- Порядок применения: 145 → 146, затем resync Inngest (`PUT /api/inngest`).

### Точка решения для PO
- **Авто-назначение по умолчанию включено** (рекомендация оркестратора; ответ PO ещё не получен). Оно делает эксперта ответственным клиента — с записью в журнал аудита и только для обычных клиентов (`client` / `owner`). Выключается тумблером «Назначать автоматически» в Настройках ГИГА → «SLA экспертов».
- `owner` отнесён к клиентам: по `lib/profiles/client-roles.ts` это клиентская роль. Если нужно строго `role = 'client'` — правка в одну строку в `isPlainClientRow`.
- Окно наследования часов для пересобранной работы равно сроку ответа (48 ч). Длиннее или короче — решение PO.
