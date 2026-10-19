# Точка Б — Ф6a (рекомендации с проверкой экспертом, правила, AI-инвайты): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рекомендации по плану (правила + ИИ) проходят очередь проверки эксперта и показываются клиенту **только после проверки**, с кем/когда/для чего проверено; детерминированные правила (ограничивающий фактор, противоречия, риски денег и команды) порождают персональные инвайты — карточки в «Обзоре», колокольчик, всплывающие окна и (по согласию клиента) письмо/Telegram не чаще раза в неделю.

**Architecture:** Две таблицы (`pb_recommendations`, `pb_invites`, миграция 129). Чистые модули правил `lib/point-b/insights/*` читают `ModelResult` и состояние плана и дают кандидатов; ИИ (`lib/point-b/recs/ai.ts`) получает **только числа из модели** как «землю» и возвращает структурированные рекомендации без числовых полей — любое число в тексте, которого нет в контексте, отбрасывает запись; все рекомендации ИИ и правил входят в очередь `pending_review`. `runInviteRules` создаёт инвайты (дедупликация, суточные/недельные лимиты, пауза «отложить/закрыть») и доставляет: страница, колокольчик (`notifyClient`), всплывающий слой Ф1б (расширяется на `insight`/`recommendation`), внешний канал — только через настройки категории уведомлений клиента и не чаще раза в неделю. Пересчёт по расписанию, план-факт и сверка — Ф6b.

**Tech Stack:** TypeScript, Next.js 14, Supabase (service client, RLS), Zod, Vitest, AI gateway (`lib/ai/gateway`, `callLlmJson`, `fenceUntrusted`, `guardAiBudget`), SVG без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§12 ИИ-стратег, экспертная проверка, §12.1 инвайты, §12.2 всплывающий слой, §6 видимость, §17). Предыдущие планы Ф0–Ф5 должны быть в main.

## Global Constraints

- Те же ограничения, что в планах Ф1–Ф5: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; не трогать реестр метрик, анкету и `lib/point-a/**`; локальный `.env` = **продовая БД**: без dev-сервера и записывающих скриптов, **миграцию 129 применяет ведущий при отправке в main** (слово PO получено); тесты без сети и БД; **никаких реальных вызовов LLM, Telegram, Resend** (моки); UI на русском на токенах проекта (без зашитых цветов, PO заменит дизайн); фильтр мата на вводимые тексты и на выход ИИ (маскирование через `lib/moderation`); `tsc`, `eslint`, тесты зелёные; отдельный коммит на задачу с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), редкий таймаут интеграционных `point-a-aggregate` / `metrics-resolver` / `ai-features`).
- **Клиент видит рекомендации только в статусе `expert_verified`**; для `pending_review` — только счётчик «N на проверке»; `stale` показывается серой пометкой «Требует обновления»; `expert_rejected` клиенту не показывается. Название «проверено экспертом» ставится **только** действием эксперта (имя, специализация, дата, версия рекомендации, область применимости, комментарий); ИИ и правила не могут выставить этот статус.
- Рекомендация содержит (спека §12): суть, причину, ожидаемый результат, ресурсы, уровень уверенности с обоснованием, риски, следующее действие, **источники** (метрики, снимок, проверки). Числа в рекомендациях — **только из модели**: LLM не генерирует цифры; ответ ИИ — Zod-схема без числовых полей, кроме перечислений; после ответа каждое число в тексте сверяется с набором разрешённых чисел контекста, запись с «чужим» числом отбрасывается (с записью в `warnings` прогона).
- Ограничивающий фактор роста, противоречия плана и триггеры инвайтов определяются **правилами**, а не LLM; ИИ формулирует объяснение к уже найденному.
- Дисциплина расходов и БД: ИИ вызывается только по кнопке эксперта (Ф6a; расписание — Ф6b), не чаще одного вызова на компанию в 10 минут, не более 5 рекомендаций за вызов, бюджет через `guardAiBudget` (новая функция учёта `point_b_recs` — по образцу `point_b_strategy`), таймаут и повтор по правилам шлюза; правила и инвайты — только индексированные запросы, партиями; ничего не держит соединение в паузах.
- Инвайты: ненавязчивые и объяснимые («почему вы это видите» + источники); не более 3 видимых карточек на странице; не более 3 карточек всплывающего слоя в сутки (настройка Ф1б `pb_popup_cards_per_day`); одно правило по одному предмету не повторяется (`dedupe_key`); «закрыть» = пауза правила 14 дней, «отложить» 3/7/30 дней; срок жизни инвайта (`expires_at`); внешний канал (письмо/Telegram через `notifyClient` по настройкам категории) — не чаще **1 раза в неделю на пользователя** (`claimSend` с ключом недели), только для PRO, не в режиме «от имени»; WhatsApp — V2.
- Видимость и права как в Ф1–Ф5: клиентские маршруты — сессия, гейт `point_b` (402), запись запрещена в режиме «от имени»; экспертные — `clients.review` + `guardClientAccess`/`forbidTarget`, аудит `recordAdminAction`.

## Review Focus

- ИИ вернул рекомендацию с числом, которого нет во входных данных, пустой/мусорный JSON, мат, слишком длинный текст, больше 5 записей, дубль существующей → запись отброшена или обрезана, причина в `warnings`, ничего ложного клиенту не показано, повторного списания бюджета нет.
- Клиент никогда не видит `ai_generated`, `pending_review`, `expert_rejected` и рекомендации другого клиента; рекомендация, изменённая экспертом после проверки, получает новую `rec_version` и снова `pending_review` (старая версия — `stale`).
- Параллельная проверка одной рекомендации двумя экспертами → один успех, второй 409; эксперт не назначенного клиента → 403; проверка без имени/области применимости → 400.
- Инвайт не дублируется (один `dedupe_key`), не появляется чаще лимитов, не создаётся в режиме «от имени», не уходит наружу чаще раза в неделю и без согласия по настройкам; закрытый на 14 дней не возвращается раньше срока; при отсутствии таблиц (миграция 129 не применена) страница и всплывающий слой молчат, а не падают.
- Правила на пустых и частичных данных (уровень 0, нет сценариев, нет финмодели) → нет инвайтов-выдумок и нет падений; «ограничивающий фактор» не определяется без данных и не выдумывается.

---

## Контракты

```ts
// lib/point-b/recs/types.ts
export type RecKind = 'lever' | 'risk' | 'action' | 'contradiction' | 'constraint'
export type RecStatus = 'pending_review' | 'expert_verified' | 'expert_rejected' | 'stale'   // ai_generated живёт мгновение: запись создаётся сразу как pending_review с generated_by
export type RecSource = 'rule' | 'ai' | 'expert'
export interface RecSourceRef { type: 'metric' | 'model' | 'snapshot' | 'check' | 'scenario' | 'finmodel' | 'goal'; ref: string; label: string }
export interface Recommendation {
  id: string; companyId: string; versionId: string | null
  kind: RecKind; title: string; essence: string; reason: string
  expectedEffect: string | null; resources: string | null
  confidence: 'low' | 'medium' | 'high'; confidenceReason: string | null
  risks: string | null; nextAction: string | null
  sourceRefs: RecSourceRef[]
  status: RecStatus; generatedBy: RecSource; inputsHash: string | null
  recVersion: number; supersedesId: string | null
  reviewerName: string | null; reviewerSpecialty: string | null; reviewedAt: string | null
  scopeNote: string | null; reviewComment: string | null
  createdAt: string; updatedAt: string
}
export interface ClientRecommendationView { id: string; kind: RecKind; title: string; essence: string; reason: string; expectedEffect: string | null; resources: string | null; confidence: Recommendation['confidence']; confidenceReason: string | null; risks: string | null; nextAction: string | null; sourceRefs: RecSourceRef[]; state: 'verified' | 'stale'; reviewerName: string | null; reviewerSpecialty: string | null; reviewedAt: string | null; scopeNote: string | null }
// lib/point-b/insights/rules.ts
export interface InsightCandidate { ruleKey: string; dedupeKey: string; kind: 'insight' | 'recommendation'; title: string; body: string; href: string | null; priority: number /* меньше = важнее */; display: 'card' | 'modal'; why: string; sourceRefs: RecSourceRef[]; expiresInDays: number }
export function evaluateInsightRules(input: { result: ModelResult; selectedScenario: string | null; finmodelMissing: number; pendingCorrection: boolean }): InsightCandidate[]
// lib/point-b/insights/constraint.ts
export function findLimitingFactor(result: ModelResult, blocks: Array<{ key: string; score: number | null }>): { lever: string; label: string; reason: string; sourceRefs: RecSourceRef[] } | null
// lib/point-b/insights/contradictions.ts
export function findContradictions(input: { result: ModelResult; selectedScenario: string | null; goalMonths: number | null }): Array<{ key: string; title: string; reason: string; sourceRefs: RecSourceRef[] }>
// lib/point-b/invites/types.ts
export type InviteStatus = 'new' | 'seen' | 'dismissed' | 'snoozed' | 'acted' | 'expired'
export interface InviteView { id: string; kind: 'insight' | 'recommendation'; title: string; body: string; href: string | null; why: string; sourceRefs: RecSourceRef[]; display: 'card' | 'modal'; createdAt: string }
// PointBState (аддитивно): recommendations: { verified: ClientRecommendationView[]; pendingCount: number }, invites: InviteView[], nextStep: { title: string; action: string | null; recId: string | null } | null
```

Правила `evaluateInsightRules` (все — детерминированные, без LLM; тексты по-русски; числа только из `result`):
1. `cash_gap` — у выбранного (или «Умеренного») сценария `finance.cashGapMonth !== null` → «Кассовый разрыв в месяце N при выбранном темпе. Рассчитать безопасный резерв?» (`href` → вкладка «Что если»), `priority 1`, `display` — `modal` только если разрыв в первые 6 месяцев.
2. `funding_need` — `finance.fundingNeed > 0` без разрыва → «Для выбранного темпа нужен резерв около X»; `priority 3`.
3. `staff_load` — `investments.staffNeed > 0` → «Выбранному темпу нужно около N новых сотрудников. Оценить найм в «Что если»?»; `priority 3`.
4. `conversion_gap` — воронка и требуемый рост конверсии ≥ 20% → «Цель требует роста конверсии с A до B. Построить план улучшения продаж?» (`href` → «Стратегия»); `priority 2`.
5. `finmodel_gap` — уровень 1 и в `finmodelMissing` ≥ 1 → «Добавьте данные о деньгах — покажем кассовый разрыв»; `priority 4`, `expiresInDays 30`.
6. `pace_behind` — вердикт `behind` или `at_risk` → «Текущий ход отстаёт от цели: прогноз X при цели Y. Пересмотреть стратегию?»; `priority 2`.
7. `infeasible` — выбранный сценарий `feasible: false` → «Выбранный темп недостижим: <причина>»; `priority 1`.
Кандидаты сортируются по `priority`; `dedupeKey` = `ruleKey` + предмет (сценарий/месяц/округлённое число), чтобы то же правило по тому же предмету не повторялось.

---

### Task 1: Миграция 129 — рекомендации и инвайты

**Files:**
- Create: `supabase/migrations/129_point_b_recommendations_invites.sql`
- Test: `tests/unit/point-b/migration-129.test.ts` (по образцу `migration-128.test.ts`)

**Interfaces:**
- Produces:
  - `public.pb_recommendations` (колонки по контракту `Recommendation`: `id uuid pk`, `company_id text → companies on delete cascade`, `version_id uuid → pb_plan_versions on delete set null`, `kind` check in 5 видов, `title` 1–200, `essence` ≤ 2000, `reason` ≤ 2000, `expected_effect`/`resources`/`risks`/`next_action`/`confidence_reason`/`scope_note`/`review_comment` text ≤ 2000, `confidence` check in ('low','medium','high'), `source_refs jsonb` (массив, ≤ 16 КБ), `status` check in 4 статуса, `generated_by` check in ('rule','ai','expert'), `inputs_hash text`, `rec_version int ≥ 1 default 1`, `supersedes_id uuid → pb_recommendations on delete set null`, `reviewer_id uuid`, `reviewer_name`, `reviewer_specialty` ≤ 200, `reviewed_at`, `created_at`, `updated_at`; индексы `(company_id, status, created_at desc)` и частичный `(created_at) where status = 'pending_review'`; триггер `set_updated_at`; RLS включён, `REVOKE ALL … FROM PUBLIC, anon`; `GRANT SELECT TO authenticated` с политикой: `status = 'expert_verified' AND public.can_read_company(company_id)` (клиент читает только проверенные); запись только `service_role`).
  - `public.pb_invites` (`id uuid pk`, `company_id text → companies`, `user_id uuid → auth.users on delete cascade`, `rule_key text`, `dedupe_key text`, `kind` in ('insight','recommendation'), `title` ≤ 200, `body` ≤ 1000, `href` ≤ 300, `why text` ≤ 600, `source_refs jsonb`, `priority smallint`, `display` in ('card','modal'), `status` in 6 статусов default 'new', `snoozed_until timestamptz`, `expires_at timestamptz`, `delivered jsonb default '{}'`, `source_rec_id uuid → pb_recommendations on delete set null`, `created_at`, `updated_at`; частичный уникальный индекс `(user_id, dedupe_key) WHERE status IN ('new','seen','snoozed')`; индекс `(user_id, status, created_at desc)`; триггер; RLS: `GRANT SELECT TO authenticated` с политикой `user_id = (SELECT auth.uid())`; запись только `service_role`).
  - Идемпотентна; `NOTIFY pgrst, 'reload schema'`.
- [ ] **Step 1: Write the failing test** (читает SQL): `'creates both tables idempotently'`; `'RLS on and anon revoked on both; authenticated has no write grants'`; `'the client policy on recommendations exposes only expert_verified'`; `'unique partial index on invites (user_id, dedupe_key) for active statuses'`; `'check constraints: statuses, kinds, confidence, generated_by, lengths'`; `'indexes and updated_at triggers exist'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/migration-129.test.ts` → FAIL. **Step 3: Implement** (шапка-комментарий в стиле 128; **не применять**). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): migration 129 — recommendations and invites`.

### Task 2: Правила — инсайты, ограничивающий фактор, противоречия

**Files:**
- Create: `lib/point-b/insights/rules.ts`, `constraint.ts`, `contradictions.ts`, `lib/point-b/recs/types.ts` (типы выше), `lib/point-b/invites/types.ts`
- Test: `tests/unit/point-b/insights-rules.test.ts`

**Interfaces:** контракты выше; `findLimitingFactor`: по сценарию «Умеренный» (или первому достижимому) выбирается рычаг с наибольшим отношением `требуемый прирост / потолок реализуемости` (потолки — из Ф2 `scenarios.ts`; если экспорта нет — добавить экспорт констант без изменения поведения), при равенстве — рычаг, связанный с самым слабым блоком Точки А (`leads → marketing`, `conversion → sales`, `avgCheck → sales`, `repeat → sales`); возвращает `null`, если нет уровня 1 или сценариев. `findContradictions` (правила спеки §12, только на имеющихся данных): (a) выбранный сценарий не укладывается в срок цели (`timeToGoal.base > months`) при заявленной цели; (b) сценарий с кассовым разрывом выбран как основной; (c) рост выручки в разы без найма при известных численности и `staffNeed > 0`; (d) цель не сходится с базой (предупреждение модели о расхождении калибровки); (e) главная цель не проверена экспертом при выбранном сценарии.
- [ ] **Step 1: Write the failing tests** (на фикстурах `ModelResult` из Ф2–Ф3): по тесту на каждое из 7 правил (срабатывает/не срабатывает на границе: конверсия +19% нет, +20% да; разрыв в месяце 6 → `modal`, в месяце 7 → `card`); `'rules are silent at level 0 and without scenarios'`; `'dedupeKey differs by scenario and month'`; `'texts contain only numbers present in the result'` (проверка регулярным извлечением чисел против набора из `result`); `'candidates are sorted by priority'`; `'findLimitingFactor picks the lever with the highest required-to-cap ratio and returns null without data'`; `'contradictions (a)–(e) trigger and stay silent on consistent data'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (чистые функции, без IO и `Date.now()`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): insight rules, limiting factor and contradictions`.

### Task 3: Хранилище рекомендаций и проверка экспертом

**Files:**
- Create: `lib/point-b/recs/store.ts`
- Modify: `tests/unit/point-b/_pbdb.ts` (аддитивно: таблицы `pb_recommendations`, `pb_invites`, уникальность активных инвайтов)
- Test: `tests/unit/point-b/recs-store.test.ts`

**Interfaces:**
- Produces (сервисный `SupabaseClient`):
  ```ts
  listRecommendations(sb, companyId: string, opts?: { statuses?: RecStatus[] }): Promise<Recommendation[]>
  createRecommendations(sb, input: { companyId: string; versionId: string | null; items: Array<Omit<Recommendation, 'id'|'companyId'|'versionId'|'status'|'recVersion'|'supersedesId'|'reviewerName'|'reviewerSpecialty'|'reviewedAt'|'scopeNote'|'reviewComment'|'createdAt'|'updatedAt'> & { status?: 'pending_review' }> }): Promise<Recommendation[]>   // дубликат по (company, title, inputsHash, kind) среди живых пропускается; мат маскируется; длины режутся
  createExpertRecommendation(sb, input: { companyId: string; versionId: string | null; draft: <поля рекомендации>; reviewer: { id: string; name: string; specialty: string | null }; scopeNote: string | null }): Promise<Recommendation>   // источник 'expert', сразу expert_verified
  verifyRecommendation(sb, input: { id: string; companyId: string; reviewer: { id: string; name: string; specialty: string | null }; scopeNote: string; comment?: string | null }): Promise<Recommendation>   // условное обновление where status = 'pending_review'; имя и область обязательны
  rejectRecommendation(sb, input: { id: string; companyId: string; reviewer: { id: string; name: string }; comment: string }): Promise<Recommendation>   // комментарий обязателен
  editRecommendation(sb, input: { id: string; companyId: string; patch: Partial<Pick<Recommendation, 'title'|'essence'|'reason'|'expectedEffect'|'resources'|'confidence'|'confidenceReason'|'risks'|'nextAction'>>; editor: { id: string; name: string } }): Promise<Recommendation>   // создаёт новую запись rec_version + 1, supersedes_id = старая, старая → stale, новая pending_review
  markStale(sb, companyId: string, currentInputsHash: string): Promise<number>   // verified/pending с другим inputs_hash → stale
  clientView(recs: Recommendation[]): { verified: ClientRecommendationView[]; pendingCount: number }   // только verified и stale(ранее проверенные) — см. правило ниже
  export class RecError extends Error { code: 'not_found' | 'bad_state' | 'invalid'; field?: string }
  ```
  Правило `clientView`: `expert_verified` → `state: 'verified'`; `stale` показывается как `state: 'stale'` **только если** была проверена (есть `reviewed_at`); `pending_review` считается в `pendingCount`; `expert_rejected` и непроверенные `stale` не показываются.
- [ ] **Step 1: Write the failing tests:** `'createRecommendations stores pending_review, masks profanity, trims lengths and skips a live duplicate'`; `'verify requires the reviewer name and the scope note and writes reviewer, specialty, date, scope and comment'`; `'two concurrent verifies: exactly one succeeds, the second is bad_state'`; `'verifying an already verified or rejected recommendation is bad_state'`; `'reject requires a comment'`; `'edit creates rec_version + 1 as pending_review and makes the old one stale with supersedes_id'`; `'markStale moves verified and pending recommendations with another hash to stale and leaves rejected ones'`; `'createExpertRecommendation is verified at once with the expert as reviewer'`; `'clientView shows verified and previously-verified stale, counts pending, hides rejected and never-verified stale'`; `'a recommendation of another company is not_found'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): recommendation store with expert verification`.

### Task 4: Генерация рекомендаций ИИ

**Files:**
- Create: `lib/point-b/recs/ai.ts`, `lib/point-b/recs/context.ts`
- Modify: `lib/ai/budget.ts` (аддитивно: функция учёта `point_b_recs` по образцу `point_b_strategy`)
- Test: `tests/unit/point-b/recs-ai.test.ts` (мок `callLlmJson`)

**Interfaces:**
- Produces:
  ```ts
  buildRecsContext(input: { result: ModelResult; selectedScenario: string | null; blocks: Array<{ key: string; title: string; score: number | null }>; strategyOutline: string[]; goalText: string | null }): { text: string; allowedNumbers: Set<string> }   // числа в текстовом виде как в UI (форматирование чисел из overviewModel/fmt) + их разложения
  generateRecommendations(input: { sb: SupabaseClient; companyId: string; userId: string; context: ReturnType<typeof buildRecsContext>; lastAiRunAt: string | null; now: Date }): Promise<{ items: RecDraft[]; warnings: string[]; usage: LlmUsage | null }>
  ```
  Правила: схема Zod (до 5 элементов; поля `kind`, `title ≤ 120`, `essence ≤ 600`, `reason ≤ 600`, `expectedEffect ≤ 400`, `resources ≤ 300`, `confidence` enum, `confidenceReason ≤ 300`, `risks ≤ 400`, `nextAction ≤ 300`); пользовательские тексты (цель, названия узлов стратегии) оборачиваются `fenceUntrusted`; системный промпт: «числа бери только из блока Данные; не придумывай»; после ответа — `guardNumbers(item, allowedNumbers)` отбрасывает запись с числом вне набора (warning «отброшена: число не из данных»); мат в выходе маскируется; частота — не чаще раза в 10 минут на компанию (`lastAiRunAt`), иначе `{ items: [], warnings: ['too_soon'] }` без вызова; бюджет через `guardAiBudget`/учёт; отсутствие ключа/ошибка шлюза → `{ items: [], warnings: [код] }` без исключения; каждый элемент получает `sourceRefs` из контекста (метрики/сценарий/блоки, на которые он ссылается — определяется по ключам, которые модель вернула в необязательном поле `refs` из закрытого списка допустимых id) и `generatedBy: 'ai'`, `inputsHash` от контекста.
- [ ] **Step 1: Write the failing tests** (мок шлюза): `'builds a context with the model numbers and an allowed-number set'`; `'a valid answer becomes drafts with refs only from the allowed list'`; `'an item with a number outside the context is dropped with a warning'`; `'more than 5 items are cut to 5'`; `'profanity in the output is masked'`; `'malformed JSON or a gateway error → no items, a warning and no throw'`; `'a second call within 10 minutes makes no LLM call'`; `'user text goes through fenceUntrusted'`; `'budget refusal → no items and a warning'`; `'no API key → no items and a warning'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): AI recommendations grounded in model numbers`.

### Task 5: Инвайты — создание, лимиты, доставка

**Files:**
- Create: `lib/point-b/invites/store.ts`, `deliver.ts`, `run.ts`
- Test: `tests/unit/point-b/invites.test.ts`

**Interfaces:**
- Produces:
  ```ts
  createInvites(sb, input: { companyId: string; userId: string; candidates: InsightCandidate[]; now: Date; sourceRecId?: string | null }): Promise<{ created: Array<{ id: string; ruleKey: string }>; skipped: Array<{ ruleKey: string; reason: 'duplicate' | 'dismissed_recently' | 'cap' }> }>   // проверки: активный dedupe_key; закрытый (dismissed) по этому ruleKey < 14 суток назад; не больше 3 активных карточек у пользователя; срок жизни expiresInDays
  listActiveInvites(sb, userId: string, now: Date): Promise<InviteView[]>   // new/seen, не snoozed, не просрочены, ≤ 3 по приоритету
  patchInvite(sb, input: { id: string; userId: string; action: 'seen' | 'dismiss' | 'snooze' | 'acted'; days?: 3 | 7 | 30; now: Date }): Promise<boolean>   // только свой инвайт
  deliverInvite(sb, input: { invite: { id: string; title: string; body: string; href: string | null }; userId: string; now: Date; pro: boolean; impersonating: boolean }): Promise<{ bell: boolean; external: 'sent' | 'capped' | 'off' }>   // колокольчик через notifyClient (категория 'reminders'; для kind recommendation — 'expert'); внешний канал — через настройки категории, claimSend с ключом ISO-недели, один раз в неделю
  runInviteRules(sb, input: { userId: string; companyId: string; now: Date }): Promise<{ created: number; skipped: number }>   // loadModelForCompany + computeModel + evaluateInsightRules + createInvites + deliverInvite для созданных; не бросает; не создаёт в режиме «от имени»; не создаёт без PRO; при отсутствии таблиц — тихо {0,0}
  inviteFromVerifiedRecommendation(sb, input: { rec: Recommendation; userId: string; now: Date }): Promise<void>   // «Эксперт подтвердил рекомендацию: <название>. Посмотреть?» с dedupe по id рекомендации, display 'card'
  ```
- Consumes: `evaluateInsightRules` (Task 2), `loadModelForCompany`/`computeModel` (Ф2–Ф3), `notifyClient`, `claimSend`/`releaseSend` (`lib/notifications/store`), `readEntitlements`/`can`.
- [ ] **Step 1: Write the failing tests:** `'the same dedupe key is not created twice while active'`; `'a rule dismissed 10 days ago is skipped, 15 days ago is allowed'`; `'at most 3 active cards per user: the 4th is skipped with cap'`; `'snooze 7 days hides the invite until the date'`; `'expired invites are not listed'`; `'patch works only on the owner’s invite'`; `'deliver: bell always, external at most once per ISO week and only when the category channel is enabled; second invite in the same week is capped'`; `'runInviteRules creates insights from the model, does nothing at level 0, for a free tier with gates on, or while impersonating'`; `'runInviteRules without migration 129 returns 0/0 and does not throw'`; `'inviteFromVerifiedRecommendation dedupes by recommendation id'`; `'no outgoing channel for impersonation'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/notifications` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): invites — creation with caps and dedupe, delivery, rule runner`.

### Task 6: Маршруты, состояние страницы и всплывающий слой (сервер)

**Files:**
- Create: `app/api/giga-admin/users/[id]/point-b/recommendations/route.ts` (GET список и счётчики; POST `{ action: 'generate_ai' | 'run_rules' | 'create', … }`), `…/recommendations/[recId]/route.ts` (PATCH `{ action: 'verify' | 'reject' | 'edit', … }`), `app/api/giga-admin/point-b/recommendations/queue/route.ts` (GET очередь `pending_review` в области актёра), `app/api/v1/point-b/invites/[id]/route.ts` (PATCH `{ action, days? }` — для карточек страницы)
- Modify: `lib/point-b/model/load.ts` и `types.ts` (`PointBState.recommendations`, `invites`, `nextStep`), `lib/point-b/plan/flow.ts` (после одобрения — `runInviteRules`, best-effort), `app/api/v1/popups/route.ts` и `app/api/v1/popups/[id]/route.ts`, `lib/popups/store.ts`/`select.ts` (кандидаты `insight`/`recommendation` из `pb_invites`; `pro` из `readEntitlements`; PATCH принимает необязательное поле `kind` и меняет инвайт или сообщение), `lib/popups/types.ts`
- Test: `tests/unit/point-b/routes-recs.test.ts`, дополнить `tests/unit/popups/routes.test.ts` и `routes-model.test.ts`

**Interfaces:**
- Produces: ответы `{ ok, data }` / `{ ok:false, error, code?, field? }`; коды: 400 (`invalid`, мат с `field`), 403, 404, 409 (`bad_state`), 429 (генерация ИИ — `isRateLimitedKey` 10/час на эксперта), 402 для клиентских маршрутов без PRO.
  - Эксперт `POST …/recommendations` `generate_ai`: собирает контекст из модели и стратегии выбранной/опубликованной версии, вызывает `generateRecommendations`, сохраняет через `createRecommendations`, также добавляет рекомендации-правила (`findLimitingFactor`, `findContradictions`) как `generated_by: 'rule'`; ответ — созданные + `warnings`; `run_rules` — `runInviteRules` для клиента (результат счётчиками); `create` — рекомендация эксперта (`createExpertRecommendation`, сразу проверена). Аудит: `point_b.recommendations.generated|rules_run|created`.
  - Эксперт `PATCH …/[recId]`: `verify` `{ scopeNote, comment? }` (имя и специализацию берёт из профиля актёра; нет профиля → «Эксперт AIStart360»), `reject` `{ comment }`, `edit` `{ patch }`; после `verify` — `inviteFromVerifiedRecommendation`; аудит `point_b.recommendation.verified|rejected|edited`.
  - `PointBState.recommendations` = `clientView(listRecommendations(...))` только для компании пользователя; `invites` = `listActiveInvites`; `nextStep` = следующее действие самой приоритетной проверенной рекомендации (`nextAction`) либо ближайшая невыполненная задача стратегии; `null`, если нечего показать; при отсутствии таблиц 129 — пустые значения.
  - Всплывающий слой: `GET /api/v1/popups` добавляет кандидатов `kind: 'insight' | 'recommendation'` из активных инвайтов с `display` из инвайта; `selectPopups` получает `pro` из `readEntitlements` (вместо заглушки `false`); `PATCH /api/v1/popups/[id]` с `kind: 'insight' | 'recommendation'` вызывает `patchInvite` (иначе прежнее поведение для сообщений); «от имени» — GET пусто, PATCH 403 (как в Ф1б).
- [ ] **Step 1: Write the failing tests:** `'expert generate_ai stores rule and AI recommendations as pending_review and returns the warnings; 429 over the hourly limit'`; `'verify/reject/edit permissions: clients.review + client scope; another client → 403; unknown rec → 404; double verify → 409'`; `'verify without the scope note → 400 with the field'`; `'queue lists pending recommendations only within the actor’s scope'`; `'state: client sees verified (and previously verified stale), the pending count, never pending/rejected texts'`; `'state: invites and nextStep from verified recommendations; empty without migration 129'`; `'approval triggers runInviteRules best-effort and a failure does not undo the approval'`; `'invites PATCH works only on own invites; impersonating → 403'`; `'popups GET includes invites as insight/recommendation for PRO and not for free with gates on; PATCH with kind updates the invite'`; `'existing expert-message popup tests stay green'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/popups tests/unit/api` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): recommendation and invite routes, page state, pop-ups for insights and recommendations`.

### Task 7: Клиент — вкладка «Рекомендации», карточки инвайтов и «Следующий шаг»

**Files:**
- Create: `components/point-b/tabs/RecommendationsTab.tsx`, `components/point-b/recsModel.ts`, `components/point-b/InviteCards.tsx`, `components/point-b/NextStepCard.tsx`, `components/point-b/inviteController.ts`
- Modify: `components/point-b/tabs/PointBTabs.tsx` + `overviewModel.ts` (вкладка «Рекомендации» после «Дорожной карты»: Обзор · Сценарии · Стратегия · Дорожная карта · Рекомендации · Что если · Финмодель · Подробности), `components/point-b/tabs/OverviewTab.tsx` («Следующий шаг» и до 3 карточек инвайтов), `components/point-b/pointBStateController.ts` (разбор `recommendations`, `invites`, `nextStep`), `components/popups/*` (контроллер отправляет `kind` в PATCH; карточка показывает бейджи: «Проверено экспертом · имя» для рекомендаций и «Подсказка платформы · не проверена экспертом» для инсайтов; кнопка «Почему я это вижу» уже есть), `lib/point-b/fixtures.ts` + `app/dev/point-b-preview/page.tsx` (`?tab=recs`, фикстуры рекомендаций и инвайтов без реальных модулей)
- Test: `tests/unit/point-b/recs-ui.test.ts`, дополнить `tests/unit/popups/PopupLayer.test.ts`
- Поведение: **«Рекомендации»** — карточки проверенных рекомендаций (бейдж «Проверено экспертом», имя · специализация · дата · область применимости; суть, причина, ожидаемый результат, ресурсы, уровень уверенности с обоснованием, риски, следующее действие; раскрывающийся блок «Почему вы это видите» с источниками), серые карточки «Требует обновления» (stale), счётчик «N рекомендаций на проверке у эксперта» без текстов, пустые состояния («Эксперт готовит рекомендации» / «Пока нет проверенных рекомендаций»), честный текст «Рекомендации ИИ показываются только после проверки экспертом»; **«Обзор»** — карточка «Следующий шаг» (`nextStep`, с кнопкой на нужную вкладку) и до 3 карточек инвайтов (`InviteCards`: заголовок, текст, «Почему вы это видите», «Открыть», «Позже» 3/7/30, «Закрыть»; действия через `PATCH /api/v1/point-b/invites/:id`); мобильная версия; токены; доступность.
- [ ] **Step 1: Write the failing tests** (контроллеры без React + `renderToStaticMarkup`): `'verified recommendations show the expert name, specialty, date and the scope note'`; `'stale ones are greyed with «Требует обновления»'`; `'pending recommendations are never rendered, only the count'`; `'empty states'`; `'next step card and up to 3 invite cards on the overview'`; `'invite actions send the right PATCH and remove the card'`; `'popup controller sends kind and shows the right badge for insight and recommendation'`; `'tab order includes Рекомендации'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit -p .`; eslint.
- [ ] **Step 5: Commit** `feat(point-b): client recommendations tab, invite cards and next step`.

### Task 8: Эксперт — рекомендации клиента

**Files:**
- Create: `components/giga-panel/user360/point-b/RecommendationsPanel.tsx`, `recommendationsController.ts`
- Modify: `components/giga-panel/user360/PointBTab.tsx` (встроить панель), `components/giga-panel/pages/PointBQueuePage.tsx` (блок «Рекомендации на проверке» из `…/recommendations/queue`)
- Test: `tests/unit/point-b/recommendations-panel.test.ts`
- Поведение: список рекомендаций клиента по статусам (на проверке / проверены / отклонены / требуют обновления) с источником (правило / ИИ / эксперт); действия «Сгенерировать рекомендации ИИ» (состояние загрузки, `warnings`), «Применить правила и инвайты», «Добавить свою»; по каждой на проверке — «Подтвердить» (форма: область применимости с подстановкой «Для плана vN, данные на <дата>», комментарий), «Отклонить» (комментарий обязателен), «Править» (создаёт новую версию рекомендации); ошибки 400/403/409/429 текстом сервера; предупреждение «ИИ может ошибаться: проверьте числа и ссылки на данные»; в очереди админа — рекомендации на проверке по клиентам в области актёра со ссылкой в User 360.
- [ ] **Step 1: Write the failing tests:** `'groups recommendations by status and shows the source'`; `'verify form pre-fills the scope note and sends scope and comment'`; `'reject requires a comment'`; `'edit sends the patch and shows the new pending version'`; `'generate shows loading, warnings and 429 text'`; `'queue block lists pending items with links'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): expert recommendation queue and verification panel`.

### Task 9: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run`, `npx tsc --noEmit -p .`, eslint по изменённым файлам; `tests/unit/metrics/*`, `survey/*`, `point-a*/*` не менялись и зелёные; ни один тест не вызывает сеть.
- [ ] **Step 2:** визуальная проверка `/dev/point-b-preview?variant=level2&tab=recs|overview&plan=published` (десктоп и 375 px, без горизонтального переполнения); итог в `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md` («После Ф6a»).
- [ ] **Step 3:** применить миграцию 129 к проду при отправке (`node scripts/apply-migration.js supabase/migrations/129_point_b_recommendations_invites.sql`, проверка RLS и политики клиента запросом на чтение), отправка в main, ожидание деплоя, `curl`: `/api/v1/point-b/state` и `/api/v1/point-b/invites/00000000-0000-4000-8000-000000000000` (PATCH без сессии → 401); обновить память; написать план Ф6b.

## Порядок выполнения

1 → 2 → 3 → 4 → 5 → 6; Tasks 7 и 8 строятся по контрактам (мок `fetch`) параллельно с 3–6; Task 9 — последней.

## Self-Review (выполнено)

- **Покрытие спеки (§12, §12.1, §12.2):** рекомендации со всеми полями, статусами и источниками (T1, T3, T7); экспертная верификация с именем, специализацией, датой, версией, областью, комментарием (T3, T6, T8); клиент видит только проверенные (T1 политика RLS, T3 `clientView`, T6, T7); ограничивающий фактор и противоречия — правилами (T2); ИИ только формулирует, числа из модели, защита от «чужих» чисел (T4); инвайты — персональные, объяснимые, ограниченные по частоте, закрытие/откладывание, дедупликация, внешний канал раз в неделю по настройкам (T5, T7); всплывающие окна для инсайтов и проверенных рекомендаций (T6, T7). Не входят: пересчёт по расписанию, `stale` по `inputs_hash` по cron, план-факт, сверка и сравнение версий — Ф6b; WhatsApp-доставка инвайтов, чат стратегии — V2/V3.
- **Типы:** `Recommendation`, `ClientRecommendationView`, `InsightCandidate`, `InviteView` объявлены в контрактах (T2) и используются в T3–T8; `PointBState.recommendations/invites/nextStep` (T6) читаются в T7.
- **Review Focus:** числа ИИ (T4), видимость и версии рекомендаций (T3, T6, T7), гонки и права (T3, T6), лимиты и канал инвайтов (T5), пустые данные и отсутствие миграции (T2, T5, T6).
- **Пропорции:** задачи — сигнатуры, правила, названия тестов; тел функций нет.
