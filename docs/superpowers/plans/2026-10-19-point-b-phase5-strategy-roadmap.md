# Точка Б — Ф5 (стратегия и дорожная карта): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Эксперт собирает в черновике версии плана дерево «стратегия → инициатива → задача» (ответственные, сроки, влияние и усилие, KPI, зависимости) и контрольные точки; после одобрения клиент видит стратегию с прогрессом, матрицу «влияние × усилие» и дорожную карту, а задачи появляются в его плане действий и считают прогресс автоматически.

**Architecture:** Дерево и контрольные точки хранятся в уже существующей колонке `pb_plan_versions.strategy` (jsonb): оно версионируется, неизменяемо после одобрения и копируется в новый черновик (`createDraft` с `fromVersion`). Задачи при публикации версии материализуются в существующую таблицу `action_items` (`source = 'point_b'`, миграция 128 добавляет только две колонки связи); прогресс инициатив и стратегий считается на чтении из живых статусов `action_items`. Чистые модули `lib/point-b/strategy/*`: валидация, матрица, прогресс. Клиенту — только одобренная версия.

**Tech Stack:** TypeScript, Next.js 14, Supabase (service client, RLS), Zod, Vitest, SVG без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§11 стратегия и дорожная карта, §6 видимость, §15 интерфейс, §21 Ф5). Предыдущие планы Ф0–Ф4 должны быть в main.

## Global Constraints

- Те же ограничения, что в планах Ф1–Ф4: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; не трогать реестр метрик, анкету и `lib/point-a/**`; локальный `.env` = **продовая БД**: без dev-сервера и записывающих скриптов, **миграцию 128 применяет ведущий при отправке в main** (слово PO получено); тесты без сети и БД; UI на русском на токенах проекта (без зашитых цветов, PO заменит дизайн); фильтр мата на все тексты, которые вводят люди; `tsc`, `eslint`, тесты зелёные; отдельный коммит на задачу с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), редкий таймаут интеграционных `point-a-aggregate` / `metrics-resolver`).
- Стратегию правит **только эксперт/админ в черновике** версии (`status = 'draft'`); одобренная версия неизменяема (триггер миграции 125); клиент видит стратегию **только из одобренной версии**; ИИ-предложения инициатив — Ф6.
- Структура: уровни строго `strategy → initiative → task` (стратегия — корень, инициатива — ребёнок стратегии, задача — ребёнок инициативы); лимиты: стратегий ≤ 12, инициатив ≤ 60, задач ≤ 300, контрольных точек ≤ 24; название ≤ 200 символов, описание ≤ 2000; весь JSON ≤ 400 КБ; `impact` и `effort` — целые 1–5 (только у стратегий и инициатив); `dependsOn` — ключи узлов **того же уровня**, без циклов и ссылок на себя; даты `YYYY-MM-DD`.
- Задачи → `action_items` только при **публикации** (одобрении) версии, идемпотентно по `(user_id, pb_task_key)`; существующие невыполненные задачи этого плана обновляются (название, описание, срок, ответственный), выполненные не трогаются, а задачи, которых нет в новой версии, остаются как есть (известное ограничение, описано в отчёте); ошибка синхронизации **не отменяет** публикацию (логируется, аудит `point_b.tasks.sync_failed`, эксперту показывается предупреждение).
- Нет данных → «—» и честное пустое состояние; никаких выдуманных значений; прогресс инициативы без задач — «нет задач», не 0%.

## Review Focus

- Дерево с циклом зависимостей, задача без инициативы, инициатива без стратегии, дубль ключа, ключ зависимости из другого уровня, слишком глубокая вложенность, больше лимитов → отказ валидации с понятным текстом и полем (`items[3].dependsOn`), ничего не сохраняется.
- Публикация версии дважды / параллельно → задачи не дублируются (уникальный индекс `(user_id, pb_task_key)`); отказ синхронизации (например миграция 128 ещё не применена) не ломает одобрение версии.
- Эксперт правит одобренную версию или версию на проверке → 409; эксперт не назначенного клиента → 403; клиент видит стратегию неодобренной версии → нельзя.
- Задача выполнена клиентом в плане действий → прогресс инициативы и стратегии на странице Точки Б обновляется; удалённая клиентом задача не ломает расчёт (считается только существующее).
- Пустая стратегия, стратегия без задач, инициативы без оценок влияния/усилия → страница не падает; матрица показывает только оценённые инициативы и подпись, сколько без оценки.

---

## Контракты

```ts
// lib/point-b/strategy/types.ts
export type StrategyKind = 'strategy' | 'initiative' | 'task'
export interface StrategyNode {
  key: string                       // uuid, стабилен между версиями (связь с action_items.pb_task_key)
  kind: StrategyKind; parentKey: string | null
  title: string; description: string | null
  ownerLabel: string | null; dueDate: string | null            // YYYY-MM-DD
  impact: number | null; effort: number | null                  // 1..5, только strategy/initiative
  metricId: string | null; block: string | null                 // ключ метрики реестра и блок Точки А (только для связи, без расчётов)
  kpi: { name: string; target: number | null; unit: string | null } | null
  dependsOn: string[]; delayRisk: string | null
  order: number
}
export interface Milestone { key: string; title: string; date: string; description: string | null; kpi: string | null }
export interface PlanStrategy { items: StrategyNode[]; milestones: Milestone[] }
export const EMPTY_STRATEGY: PlanStrategy
// lib/point-b/strategy/validate.ts
export function validateStrategy(raw: unknown): { ok: true; strategy: PlanStrategy } | { ok: false; error: string; field: string }
// lib/point-b/strategy/matrix.ts
export type Quadrant = 'quick_wins' | 'big_bets' | 'fill_ins' | 'avoid'
export interface MatrixPoint { key: string; title: string; kind: 'strategy' | 'initiative'; impact: number; effort: number; quadrant: Quadrant }
export function buildMatrix(items: StrategyNode[]): { points: MatrixPoint[]; unrated: number }   // квадранты: impact ≥ 3 и effort ≤ 3 — quick_wins; impact ≥ 3 и effort ≥ 4 — big_bets; impact ≤ 2 и effort ≤ 3 — fill_ins; иначе avoid
// lib/point-b/strategy/progress.ts
export type TaskStatus = 'open' | 'in_progress' | 'done'
export interface NodeProgress { key: string; tasks: number; done: number; inProgress: number; percent: number | null; state: 'no_tasks' | 'not_started' | 'in_progress' | 'done' }
export function computeProgress(items: StrategyNode[], statusByTaskKey: Record<string, TaskStatus | undefined>): Record<string, NodeProgress>   // задача без строки в action_items не считается; инициатива и стратегия — по задачам-потомкам (доля done), состояние по правилам
// lib/point-b/strategy/tasks.ts
export function taskRowOf(node: StrategyNode, ctx: { userId: string; versionId: string; initiativeTitle: string | null }): ActionItemInsert
export async function syncPlanTasks(sb: SupabaseClient, input: { userId: string; versionId: string; strategy: PlanStrategy }): Promise<{ created: number; updated: number; skipped: number }>
export async function loadTaskStatuses(sb: SupabaseClient, userId: string, keys: string[]): Promise<Record<string, TaskStatus>>
// PointBState.plan (аддитивно): strategy: { items: StrategyNode[]; milestones: Milestone[]; progress: Record<string, NodeProgress>; matrix: { points: MatrixPoint[]; unrated: number } } | null   // только одобренная версия
```

---

### Task 1: Миграция 128 — связь задач плана с `action_items`

**Files:**
- Create: `supabase/migrations/128_point_b_action_items_link.sql`
- Test: `tests/unit/point-b/migration-128.test.ts` (по образцу `migration-127.test.ts`)

**Interfaces:**
- Produces: `ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS pb_task_key text, ADD COLUMN IF NOT EXISTS pb_version_id uuid` (ключ — `check (pb_task_key is null or length(pb_task_key) between 8 and 64)`); `CREATE UNIQUE INDEX IF NOT EXISTS action_items_pb_task_uidx ON public.action_items (user_id, pb_task_key) WHERE pb_task_key IS NOT NULL`; ничего другого не меняется (RLS и политики `action_items` остаются как есть); идемпотентна; `NOTIFY pgrst, 'reload schema'`. Колонка `source` уже существует (`default 'plan'`), значение `'point_b'` используется кодом.
- [ ] **Step 1: Write the failing test** (читает SQL): `'adds the two columns idempotently'`; `'unique partial index on (user_id, pb_task_key)'`; `'does not touch RLS or policies of action_items'`; `'key length check'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/migration-128.test.ts` → FAIL. **Step 3: Implement** (шапка-комментарий; **не применять**). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): migration 128 — link plan tasks to action_items`.

### Task 2: Чистые модули стратегии

**Files:**
- Create: `lib/point-b/strategy/types.ts`, `validate.ts`, `matrix.ts`, `progress.ts`
- Test: `tests/unit/point-b/strategy-pure.test.ts`

**Interfaces:** контракты выше. `validateStrategy`: проверка лимитов и уровней (см. Global Constraints), уникальность ключей, формат ключей (uuid-подобные, 8–64 символа), даты, `impact`/`effort` целые 1–5 и только у `strategy`/`initiative`, `dependsOn` того же уровня без циклов (поиск цикла обходом), контрольные точки (дата, название); мат в `title`, `description`, `delayRisk`, `kpi.name`, `ownerLabel`, контрольных точках → ошибка с полем (через `lib/moderation`); поле ошибки вида `items[3].dependsOn[0]` или `milestones[1].date`; пустая стратегия валидна. `computeProgress`: процент = `done / tasks · 100` (округление до целого), состояния: `no_tasks` (процент `null`), `not_started` (done 0 и in_progress 0), `in_progress`, `done` (все done); задача без статуса в словаре не считается.
- [ ] **Step 1: Write the failing tests:** `'an empty strategy is valid'`; `'a valid 3-level tree passes'`; `'an initiative without a strategy parent, a task without an initiative, a duplicate key, a self-dependency, a cross-level dependency and a dependency cycle are rejected with the field'`; `'limits: 13 strategies, 61 initiatives, 301 tasks, 25 milestones are rejected'`; `'impact 0, 6 or 2.5, and impact on a task are rejected'`; `'bad dates are rejected, including 2026-02-30'`; `'profanity in title/description/delayRisk/kpi.name/ownerLabel/milestone is rejected with the field'`; `'JSON over 400 KB is rejected'`; `'matrix: quadrants by the rule, unrated initiatives counted and left out'`; `'progress: no tasks → no_tasks and percent null; 1 of 4 done → 25 and in_progress; all done → done; tasks missing from the statuses are ignored; strategy progress aggregates its initiatives’ tasks'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): strategy tree validation, impact-effort matrix and progress`.

### Task 3: Хранилище, публикация задач и состояние страницы

**Files:**
- Create: `lib/point-b/strategy/tasks.ts`, `lib/point-b/strategy/load.ts`
- Modify: `lib/point-b/plan/store.ts` (`updateDraft` принимает `strategy?: PlanStrategy`; `saveStrategy(sb, versionId, strategy)` — только черновик, иначе `PlanError('not_editable')`), `lib/point-b/plan/flow.ts` (после успешного одобрения вызвать `syncPlanTasks`, ошибки не пробрасываются), `lib/point-b/model/load.ts` (`loadPointBState` добавляет `plan.strategy` только из одобренной версии), `lib/point-b/model/types.ts` (аддитивно: `PointBState.plan.strategy`)
- Test: `tests/unit/point-b/strategy-tasks.test.ts`, дополнить `routes-model.test.ts` и `plan-store.test.ts` (мок `_pbdb.ts` расширить таблицей `action_items` аддитивно)

**Interfaces:**
- `taskRowOf` → вставка в `action_items`: `user_id`, `title`, `description` (описание задачи + строка «Инициатива: <название>»), `status 'open'`, `owner` = `ownerLabel`, `due_date`, `expected_effect` = «KPI: <имя> → <цель> <единица>» если задан, `linked_block` = `block`, `priority` = `6 − impact` инициативы-родителя (1…5, по умолчанию 3), `source 'point_b'`, `pb_task_key = key`, `pb_version_id = versionId`.
- `syncPlanTasks`: по каждой задаче версии — вставка, если строки с `(user_id, pb_task_key)` нет; иначе обновление названия/описания/срока/ответственного/приоритета, если статус не `done`; возвращает счётчики; при отсутствии таблицы/колонок (миграция 128 не применена) бросает ошибку, которую вызывающий ловит. `loadTaskStatuses` читает статусы по ключам пачкой (до 300).
- [ ] **Step 1: Write the failing tests:** `'taskRowOf maps title, owner, due date, KPI text, priority from the parent impact, source point_b and the key'`; `'syncPlanTasks creates missing tasks and is idempotent on a second run'`; `'an existing open task is updated, a done one is left untouched'`; `'a task absent from the new version is left as it is'`; `'a failure of the sync does not undo the approval and is audited as point_b.tasks.sync_failed'`; `'saveStrategy only on a draft; in_review and approved → not_editable'`; `'createDraft copies the strategy of the previous version'`; `'state: plan.strategy comes only from the approved version, with live progress; none without an approved version; a draft’s strategy never leaks'`; `'progress follows the action_items statuses and ignores deleted tasks'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): strategy storage, tasks into the action plan on publish, live progress in the page state`.

### Task 4: Маршрут правки стратегии

**Files:**
- Create: `app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/strategy/route.ts` (PUT)
- Test: `tests/unit/point-b/routes-strategy.test.ts`

**Interfaces:**
- Produces: `PUT …/strategy` `{ strategy: PlanStrategy }` → `{ ok, data: { strategy, version } }`; `clients.review` + `guardClientAccess`/`forbidTarget` + `route-guard` Ф1 (UUID, область клиента, принадлежность версии), аудит `point_b.strategy.saved` (число узлов по уровням); 400 `{ error, field }` при отказе валидации и мате, 409 для не-черновика (`not_editable`), 404 версия чужого клиента. GET версии отдаёт `strategy` через существующий `GET …/plan`.
- [ ] **Step 1: Write the failing tests:** `'PUT saves a valid strategy into the draft and audits the counts'`; `'invalid trees answer 400 with the field and write nothing'`; `'profanity → 400 with the field'`; `'in_review or approved version → 409'`; `'expert of another client → 403; version of another client → 404'`; `'PUT replaces, not merges (a removed node is gone)'`; `'GET plan returns the draft strategy to staff only'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): route to save the plan strategy in a draft`.

### Task 5: Клиент — вкладки «Стратегия» и «Дорожная карта»

**Files:**
- Create: `components/point-b/tabs/StrategyTab.tsx`, `components/point-b/tabs/RoadmapTab.tsx`, `components/point-b/strategyModel.ts`, `components/point-b/MatrixChart.tsx`, `components/point-b/TimelineChart.tsx`
- Modify: `components/point-b/tabs/PointBTabs.tsx` + `overviewModel.ts` (вкладки «Стратегия» и «Дорожная карта» после «Сценарии»: порядок Обзор · Сценарии · Стратегия · Дорожная карта · Что если · Финмодель · Подробности), `components/point-b/pointBStateController.ts` (разбор `plan.strategy`), `lib/point-b/fixtures.ts` + `app/dev/point-b-preview/page.tsx` (`?tab=strategy|roadmap`, фикстура стратегии без реальных модулей)
- Test: `tests/unit/point-b/strategy-ui.test.ts`

**Interfaces:**
- Consumes: `PointBState.plan.strategy` (контракт; **типы** из `@/lib/point-b/strategy/types`, `MatrixPoint`/`NodeProgress` из `matrix.ts`/`progress.ts` — только типы).
- Поведение: **«Стратегия»** — карточки стратегий (название, описание, прогресс-полоса по `NodeProgress`, состояние «нет задач / не начато / в работе / выполнено»), раскрытие в инициативы (влияние и усилие значками, KPI, срок, риск задержки) и задачи (ответственный, срок, статус из плана действий со ссылкой «Открыть в плане действий» → `/client/action-plan` или существующий путь плана действий), матрица `MatrixChart` (точки по `impact × effort`, подписи квадрантов «Быстрые победы», «Крупные проекты», «Можно отложить», «Не стоит», подпись «без оценки: N»), пустое состояние «Эксперт готовит стратегию» (нет одобренной версии) или «В плане пока нет стратегии» (одобрена, но пуста); **«Дорожная карта»** — таймлайн по кварталам (`TimelineChart`: полосы стратегий/инициатив по срокам задач, ромбики контрольных точек, сегодня), список этапов и контрольных точек с датой и KPI, блок зависимостей («инициатива X ждёт Y»), статусы задач; недоступны данные → честная заглушка; мобильная версия — таймлайн превращается в список по кварталам; доступность (роли списков, подписи графиков, фокус); токены проекта.
- [ ] **Step 1: Write the failing tests** (контроллер без React + `renderToStaticMarkup`): `'strategy cards show progress bars and the four states'`; `'initiatives show impact and effort, KPI, due date and delay risk; tasks show the owner, due date and status with the link to the action plan'`; `'matrix places rated initiatives in the right quadrants and shows the unrated count'`; `'empty states: no approved version vs an approved plan with no strategy'`; `'timeline groups items by quarter, marks milestones and today, no NaN in the SVG'`; `'dependencies block lists “X ждёт Y”'`; `'tabs order includes Стратегия and Дорожная карта'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit -p .`; eslint.
- [ ] **Step 5: Commit** `feat(point-b): client strategy and roadmap tabs (tree, matrix, timeline)`.

### Task 6: Эксперт — редактор стратегии

**Files:**
- Create: `components/giga-panel/user360/point-b/StrategyPanel.tsx`, `strategyController.ts`
- Modify: `components/giga-panel/user360/point-b/PlanPanel.tsx` (встроить панель для открытой версии)
- Test: `tests/unit/point-b/strategy-panel.test.ts`

**Interfaces:**
- Consumes: `PUT …/versions/:versionId/strategy` (Task 4), `GET …/plan` (версия со `strategy`), типы и `validateStrategy` (клиентская предпроверка тем же модулем), `buildMatrix`.
- Поведение: редактируемое дерево (добавить стратегию / инициативу / задачу, удалить узел с потомками после подтверждения, вверх/вниз, перенос не нужен): поля — название, описание, ответственный, срок, влияние и усилие (1–5), KPI (имя, цель, единица), блок Точки А, метрика, зависимости (выбор из узлов того же уровня), риск задержки; контрольные точки (добавить, дата, KPI); предпросмотр матрицы; предпроверка `validateStrategy` до отправки (ошибка под нужным полем), «Сохранить стратегию» (PUT), счётчики лимитов; только для `draft` (иначе режим чтения); ключи узлов генерируются `crypto.randomUUID()` и не меняются при правках; ошибки 400/409 текстом сервера.
- [ ] **Step 1: Write the failing tests:** `'adds nodes with generated stable keys and keeps keys on edits'`; `'deleting a strategy removes its initiatives and tasks after confirmation'`; `'dependencies can be chosen only among nodes of the same level'`; `'pre-validation shows the error under the field and blocks the save'`; `'save sends the whole strategy and shows server errors'`; `'read-only for in_review and approved versions'`; `'matrix preview counts the unrated initiatives'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): expert strategy editor in the plan draft`.

### Task 7: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run`, `npx tsc --noEmit -p .`, eslint по изменённым файлам; `tests/unit/metrics/*`, `survey/*`, `point-a*/*` не менялись и зелёные.
- [ ] **Step 2:** визуальная проверка `/dev/point-b-preview?variant=level2&tab=strategy|roadmap&plan=published` (десктоп и 375 px, без горизонтального переполнения), итог в `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md` («После Ф5»).
- [ ] **Step 3:** применить миграцию 128 к проду при отправке (`node scripts/apply-migration.js supabase/migrations/128_point_b_action_items_link.sql`, проверить колонки и индекс запросом на чтение), отправка в main, ожидание деплоя, `curl` `/api/v1/point-b/state` → 401; обновить память; написать план Ф6.

## Порядок выполнения

1 → 2 → 3 → 4; Tasks 5 и 6 строятся по контрактам (мок `fetch`) параллельно с 3–4; Task 7 — последней.

## Self-Review (выполнено)

- **Покрытие спеки Ф5 (§11):** цепочка цель → стратегия → инициатива → задача → измеримый результат (KPI) в узле (T2); редактор эксперта (T6); матрица «влияние × усилие» (T2, T5); дорожная карта с этапами, контрольными точками, зависимостями, статусами, ответственными, сроками (T2, T5, T6); шаги → задачи клиента через `action_items` с автоматическим прогрессом (T3, T5). Не входят: пересмотр дорожной карты при смене темпа сценария с подтверждением (требует выбранного клиентом темпа — Ф6), ресурсы и риски задержек как числа, библиотека инициатив по отраслям (V2), ИИ-предложения инициатив (Ф6).
- **Типы:** `StrategyNode`, `PlanStrategy`, `NodeProgress`, `MatrixPoint` объявлены в контрактах (T2) и используются в T3–T6; `PointBState.plan.strategy` (T3) читается в T5.
- **Review Focus:** валидация деревьев (T2, T4), идемпотентность и отказ синхронизации (T3), доступ и неизменяемость (T3, T4), живой прогресс (T3), пустые состояния (T2, T5).
- **Пропорции:** задачи — сигнатуры, правила, названия тестов; тел функций нет.
