# R2-C — ревью безопасности и БД (коммит e8993464)

Ветка `claude/round2-paywall-experts`, diff `c9b46171..e8993464`. Ревьюер: независимый (безопасность + БД).
Код не менялся. Проверки: чтение кода, SQL на локальной тест-БД (`aistart360_test`, каждый сценарий в транзакции с ROLLBACK), тесты через `~/.a360-test/vt.sh`, один временный тест в scratchpad (не в репозитории).

Прогон тестов: `vt.sh tests/integration/db/{paid-access-one-rule,paid-sections-rls,report-review,expert-sla}.test.ts tests/unit/access tests/unit/expert-sla/policy.test.ts tests/unit/client-shell` — **34 файла, 714 тестов, всё зелёное** (интеграционные реально идут на БД, не пропущены — проверено `--reporter=verbose`).

---

## Находки

### F1. High — текст комментария эксперта уходит Free-клиенту в уведомлении (in-app + письмо)
**Где:** `app/api/expert/comments/route.ts:247-252`, `app/api/giga-admin/users/[id]/comments/route.ts:108-113` → `lib/notifications.ts:108-116` (`buildEmailBody('expert_comment')`), каналы по умолчанию `lib/notifications/preferences.ts:40` (`expert: in_app + email`).

**Сценарий:** эксперт (портал эксперта) или сотрудник (GIGA → User 360 → комментарии) пишет комментарий клиенту на Free. Строка `expert_comments` создаётся сразу со статусом `published` (значение колонки по умолчанию), и вызывается `notifyUser(clientId, 'expert_comment', { preview: text })`. Тело уведомления: «Эксперт … оставил(а) комментарий · блок "…": "<до 280 символов текста>"». Оно пишется в ленту уведомлений клиента (её можно читать в кабинете) и по умолчанию уходит письмом. Право Точки А получателя не проверяется. Так обходится решение PO M-4 («комментарии/разбор эксперта — часть Точки А, Free не получает содержимое»): `/api/v1/expert-comments` и `/api/v1/expert-review` теперь отвечают 402, RLS 148 скрывает строки, но сам текст клиент уже получил в уведомлении. Обычно комментарий короче 280 символов, то есть приходит целиком.

**Подтверждено:** временный тест `<scratchpad>/vt/expert-comment-leak.test.ts` (запуск: `vt.sh --config <scratchpad>/vt/vitest.scratch.config.mjs`). `notifyUser('expert_comment', {preview:'SECRET…'})` передаёт в `notifyClient` тело с `SECRET…`, категория `expert`, `pointAClosedFor` не вызывается. Тест прошёл. Сами маршруты прочитаны глазами: проверки права в них нет.

**Исправление:** в обоих маршрутах (или централизованно в `notifyUser` для `expert_comment` / `expert_comment_edited`) спрашивать `pointAClosedFor(clientId)`. Если раздел закрыт, слать нейтральный текст («Эксперт оставил комментарий к вашей Точке А — он входит в платный доступ») без `preview` и `blockKey`, CTA `/client/home`. Это тот же приём, что уже сделан для «Отчёт эксперта готов» в `lib/reports/review-flow.ts:384-400`. Добавить тест на оба маршрута.

### F2. High (дыра существовала до этого коммита, с 147) — `diagnostic_sessions.overview` (сводка Точки А) читается Free-сессией через PostgREST
**Где:** политика `diagnostic_sessions_select` = `can_read_company(company_id)` (`supabase/migrations/085_diagnostics_provenance_reports.sql:285-286`). В списке RESTRICTIVE-политик 147 этой таблицы нет, в списке 148 (`148_…sql:184-186`) тоже. У `authenticated` есть SELECT на таблицу и на колонку `overview`.

**Что внутри:** `overview` — это `PointAOverview` (`types/point-a-overview.ts:60`): `overallScore`, `healthIndex`, `maturity`, `problemZones`, `keyRisks` (title/body), `strengths`, `criticalGaps`, `dataGaps`. Это и есть содержимое платного `/api/v1/point-a/overview` (он закрыт `gatePaidSection('point_a')`), и из него же собирается снимок отчёта эксперта (`lib/reports/versions.ts:59-72`). Сессии создаёт оркестратор (`lib/agents/tools/diagnostics.ts:106,179`) без проверки тарифа, то есть они есть и у Free-клиентов.

**Сценарий:** Free-клиент со своим JWT и публичным anon-ключом делает `GET /rest/v1/diagnostic_sessions?select=overview&company_id=eq.<своя>` и получает балл и ключевые риски Точки А.

**Подтверждено SQL** (`<scratchpad>/chk1.sql`, ROLLBACK): Free W без членства в компаниях → `has_paid_section('point_a') = f`, `report_versions` = 0 строк, но `SELECT overview FROM diagnostic_sessions` отдаёт `score=42, risks=[{"title":"Z-secret-risk"}]`.

**Исправление:** добавить `diagnostic_sessions` → `point_a` в RESTRICTIVE-список (в новой миграции 150 или в 148, пока она не на проде). Под сессией таблицу читает только `lib/point-a/overview.ts:592` (только `id`, внутри уже закрытого `/api/v1/point-a/overview`), остальные читатели ходят через Prisma или service role, так что регрессий не жду. Альтернатива: `REVOKE SELECT (overview) … FROM authenticated`.

### F3. Medium (пробел в дизайне, нужно решение PO) — наследование тарифа компании работает на уровне человека, а не на уровне компании
**Где:** `148_…sql:82-113` (`company_inherited_rights`) и `:168-169` (шаг 5 `has_paid_section`); в приложении `lib/access/server.ts:60-64` → `withCompanyRights`.

**Сценарий:** у Free-пользователя U есть своя компания X (Free), и он активный участник (даже `viewer`) Pro-компании Y. Тогда `has_paid_section(*)` возвращает true для U везде, а не только для данных Y. U открывает платные разделы своей Free-компании X: Точку А/Б, Рынок, полный GRI без лимита (`gri_full_unlimited`), отчёт эксперта по X, PDF, ссылки; при пересчёте запускается платный ИИ для его диагностики. Есть и обратный случай: Pro-участник Free-компании F читает платные данные F, хотя владелец F их не видит (публичная ссылка на них при этом закрыта по праву владельца, то есть правила кабинета и ссылки расходятся).

**Подтверждено SQL** (`<scratchpad>/chk1.sql`): U (free, viewer Pro-компании Y) → `has_paid_section('point_a')=t`, `('market')=t`, читается `report_versions` своей компании X с `content` (`X-report-content`).

**Насколько реально:** вступить в компанию самому нельзя (проверено, см. ниже), участников сейчас заводит только персонал. На тест-БД, кроме владельцев, участников нет (`company_members` с ролью ≠ owner: 0). Пока это скорее мина на будущее, чем активная дыра, но формулировка PO («участники наследуют право владельца компании») подразумевает права на данные этой компании.

**Исправление (если PO подтвердит, что право — на данные компании):** в RLS выдавать унаследованное право только для строк этой компании, например `USING (company_id = ANY ((SELECT public.paid_company_ids('point_a'))))`: initplan с массивом своих оплаченных и унаследованных компаний, по-прежнему один вызов на запрос. Для таблиц с ключом `user_id` (`diagnostics`, `gri_*`, `expert_comments` …) — собственное право плюс право компании, к которой относится строка. В приложении — решение по `(user, company)`. Если PO подтверждает именно пользовательское наследование, это стоит записать как осознанное решение, включая роль `viewer` и платный ИИ.

### F4. Low — бывший владелец сохраняет активное членство `owner` и после смены `companies.user_id` наследует Pro нового владельца
**Где:** триггер `companies_sync_owner_membership` (`084_…sql:88-99`) только добавляет нового владельца и не понижает и не удаляет прежнего; 148 учитывает любую активную строку `owner`, если `c.user_id <> caller`.

**Подтверждено SQL** (`<scratchpad>/chk3.sql`): компания Free-пользователя A передана Pro-пользователю B (`UPDATE companies SET user_id=B`). В `company_members` остаются обе строки `owner/active`, у A `has_paid_section('point_a')=t` и `('market')=t`. Кроме того, A продолжает читать данные компании через `can_read_company` (это было и раньше).

**Насколько реально:** в коде портала ни один путь не меняет `companies.user_id`: onboarding вырезает `user_id`, GIGA `users/[id]/company` правит только поля, RLS `companies_update_own` проверяет `WITH CHECK user_id = auth.uid()`. Случиться может только при ручной правке SQL или будущей функции «передать компанию».
**Исправление:** в триггере при `UPDATE OF user_id` ставить старому владельцу `status='removed'` (или роль `member` — решает PO); или в `company_inherited_rights` не учитывать строки `role='owner'`, у которых `user_id <> c.user_id`.

### F5. Low — гонка при применении 149 одновременно с работающим SLA-cron
**Где:** `149_…sql:32-36` (UPDATE) идёт до `CREATE OR REPLACE` и до коммита. Проход `expert_sla_sync` старой версии, который начался раньше и коммитится позже UPDATE, может открыть новую задачу `rec_review` для компании, у которой открытой задачи не было. Её 149 уже не закроет, и она сможет эскалироваться. Окно узкое, проверено только чтением кода.
**Исправление:** в начале 149 взять `LOCK TABLE public.expert_sla_tasks IN SHARE ROW EXCLUSIVE MODE` (или применять при остановленном cron). Можно также повторить UPDATE после замены функции.

### F6. Low — откат 149 описан неточно
`rollback/149_…down.sql:6-7` обещает, что «следующий проход откроет свежие задачи». По правилу наследования из 146 (`answered=false`, задача закрыта не раньше 48 ч назад, та же `lineage` = компания) новая задача `rec_review` унаследует `received_at`, сроки, `escalated_at` / `breached_at` и флаги доставки задачи, закрытой как `excluded`. Значит, она может сразу оказаться эскалированной или просроченной (без повторной рассылки, если исходная уже была доставлена). На прод это не влияет, только на ожидания при откате. Исправить текст или в откате ставить `answered = NULL/true` для `excluded`.

### F7. Low — `/client/home`: при сбое решения о доступе карточка отчёта «открывается» (fail-open в интерфейсе)
`app/client/home/page.tsx:57` `.catch(() => ({ point_a: false, … }))` → `ReportReadyCard` без `locked` показывает «Открыть», PDF и id версии. Содержимого это не раскрывает: API (`/api/v1/reports/:id`, `/pdf`, `/link`) отвечают 402, RLS режет. Утечки нет, интерфейс просто обманывает. Исправление: при ошибке считать раздел закрытым (как это делает `lib/access/recipient.ts`).

### F8. Low — нагрузка: `/expert/reports` на каждый рендер делает до 100 решений о праве владельца
`app/(expert)/expert/reports/page.tsx:34-38`: каждое решение — это `companies` + `system_settings` + `profiles` + RPC через service role, то есть до ~400 запросов к PostgREST на рендер очереди из 100 версий. Предложение: одним SQL (Prisma) посчитать `has_paid`-эквивалент по владельцам пачкой или кешировать на рендер.

### F9. Low / вопрос PO — владелец с заблокированным или неодобренным аккаунтом
`company_inherited_rights` смотрит только `tier` и `feature_flags` владельца, но не `profiles.status`. Заблокированный или архивный Pro-владелец продолжает «раздавать» Pro участникам. Это предположение по коду, отдельно не тестировалось.

### F10. Info — партнёры (`partner_members`) теряют доступ к отчётам
Разрешающая политика `report_versions_select` (и findings / recommendations) явно впускает `partner_role_for_company(...)`, а RESTRICTIVE-политика 148 требует личного права `point_a` у партнёра: партнёр не персонал и не участник компании. В 147 так уже было для `diagnostics`. Партнёров на тест-БД 0, в коде портала они почти не используются (только `lib/tenancy`). Нужна только фиксация решения.

### F11. Info — роль `viewer` получает все платные права, включая `ai_chat` / `pdf_export` / `benchmarks`
Это прямо записано в 148 и проверяется тестом `viewer of a pro company`. Стоит подтвердить у PO, особенно платный ИИ для наблюдателя.

---

## Проверено и признано корректным

**Миграция 148**
- `has_paid_section` и `company_inherited_rights`: `SECURITY DEFINER`, `SET search_path = public`, владелец `postgres` (`rolbypassrls`). Рекурсии RLS нет: политики `company_members` / `companies` / `profiles` функцию не вызывают, а она читает их в обход RLS.
- Производительность: EXPLAIN ANALYZE под `authenticated` для участника Pro-компании (`report_versions`, `diagnostic_findings`, по 500 строк) показывает `InitPlan 1 … loops=1`. Функция и подзапрос по `company_members` выполняются один раз на запрос, а не на строку. Join в `company_inherited_rights` попадает в частичный индекс `company_members_user_idx (user_id) WHERE status='active'`. Построчный `can_read_company` был и раньше.
- `company_inherited_rights(p_user)`: под сессией отвечает только о себе (чужой uuid → все `false`, без ошибки и без чужих данных, SQL подтверждён); под `service_role` отвечает о любом; `anon` не имеет EXECUTE. Подделать `service_role` из клиента нельзя: claims подписаны, `set_config` через PostgREST недоступен.
- Порядок шагов (персонал → тумблер → свой override → свой тариф → компания) по результату совпадает с `decideFeature` + `readEntitlements`. Матрица из 12 случаев `paid-access-one-rule.test.ts` проходит; `invited` / `removed` ничего не дают; собственный явный `false` закрывает раздел.
- Идемпотентность (`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`, отсутствующие таблицы пропускаются), применять после 147. При неудаче — одна транзакция с `lock_timeout 5s`.
- Откат `rollback/148_…down.sql`: тело `has_paid_section` побайтно совпадает с 147 (diff пустой), удаляет 5 политик и 2 функции, данные не трогает.
- Сам вступить в Pro-компанию нельзя (SQL): `INSERT company_members` → `permission denied`; `UPDATE companies SET user_id=<чужой>` → RLS (WITH CHECK); upsert на чужую компанию → RLS (USING); `INSERT companies` с чужим `user_id` → RLS. В коде портала записи в `company_members` делает только триггер владельца, приглашения (`platform_invitations`) — только для персонала.
- Персонал, review-flow, ГИГА, cron: читают через Prisma или service role (`lib/reports/*`, `app/api/giga-admin/*`, `app/api/expert/*`, `lib/mcp`, `lib/telegram/bots/data.ts`), RLS их не касается. Сессионный персонал проходит через `current_staff_role()` / `is_active_expert()` с session gate из 143, тест «M-4: staff and the service role … still read» зелёный.
- Хранилище PDF `report-pdfs` приватное, политик `storage.objects` нет — напрямую клиент PDF не скачает.
- Realtime: таблиц 148 в публикации `supabase_realtime` нет.

**Приложение**
- `/api/v1/reports`, `/reports/:id`, `/pdf`, `/link`, `/api/v1/expert-comments`, `/api/v1/expert-review`: 402 до любого чтения (персонал проходит), затем RLS.
- `/r/v/[token]` (страница и PDF) и `/r/[token]` (Точка А / Б / GRI; OG-метаданные GRI) проверяют текущее право владельца через service role, при любой ошибке закрыто. Счётчик просмотров перенесён после проверки. `LinkUnavailable` не выводит данных.
- Уведомление о публикации отчёта (`review-flow.ts:384-400`) для закрытого получателя приходит без ссылки на версию. Письмо и уведомление «Эксперт подготовил разбор» содержат только заголовок, число комментариев и названия блоков (метаданные). PDF рецензии по email и в Telegram уходит только экспертам (`review-delivery.ts`).
- ИИ-контекст ассистента (`lib/assistant/context.ts`) не берёт отчёт и комментарии эксперта; MCP только для персонала и экспертов; клиентский бот не касается отчёта.
- «Назначить Pro» (`assign-pro/route.ts`): `requireGiga('users.manage')` с проверкой same-origin и MFA, `guardClientAccess` (зона клиентов сотрудника), `forbidTarget` (сотрудник выше), запрет назначать себе; только открытая заявка `type='access'` из `paywall` / `upgrade_modal` (заявка на регистрацию → 404, закрытая → 409); `setPlan` пишет журнал до изменения. Права те же, что в User 360 → Биллинг. Клиенты не имеют доступа к `admin_requests` (ни политик, ни грантов), поэтому подделать `payload.userId` нельзя. Закрытие заявок фильтруется по `payload->>userId`, заявки на регистрацию не задеваются. Голое «approve» для платной заявки отклоняется (409).
- `/client/home` читает метаданные отчёта через service role только для своей компании (`companies.user_id = user.id`), без `content`.

**Миграция 149**
- Тело `expert_sla_sync` отличается от 146 только удалённой веткой `rec_review` в блоке 7.5 (diff проверен); откат возвращает тело 146 побайтно; гранты (`service_role`) те же.
- Закрытые задачи `excluded` не всплывают: `expert_sla_claim`, `expert_sla_realign`, outbox (`lib/expert-sla/run.ts:203` `.is('closed_at', null)`), сводки и представления (`store.ts summarize/inView`) учитывают только открытые задачи. Строки не удаляются, CHECK `close_reason` (длина ≤ 100) выполняется. В коде портала больше никто не создаёт `rec_review`.
- `escalation_sla_hours.low` 72 → 24: меняется только значение по умолчанию в реестре; если значение уже сохранено в `system_settings`, действует оно.
