# AI-ассистент «Гри» — аудит и улучшенная спецификация

Audit date: 2026-07-07 · Auditor: AI-pipeline engineer · ID prefix: **GRI**
Scope: mascot assistant «Гри» (living SVG-cat) — proactive hints, chat, AI insight,
tours, escalation. Distinct from the `/gri` GRI-scoring diagnostic engine.

---

## 1. Executive summary

«Гри» is a genuinely mature feature: a lazy-loaded SVG-cat mascot
(`components/assistant/mascot/*`) with an anti-annoyance trigger engine, a
deterministic scripted-hint catalog, a multi-turn chat panel, per-screen
coachmark tours, 4 character skins, PII masking, an output secret-filter, and
graceful degradation to `null` when `OPENROUTER_API_KEY` is absent. Safety and
anti-hallucination are the strongest parts of the design — every fact is drawn
from a single curated, RLS-scoped snapshot (`buildAssistantContext`), and the
model is instructed to escalate rather than invent.

The gaps are about *usefulness and product depth*, not correctness. The LLM chat
(`/converse`, `/ask`) is **page-blind** (the current screen is never put in the
prompt) and **progress-blind** (survey completion % is computed in `/context`
but is NOT part of the snapshot the chat model sees). There are no explicit
quick-action *commands* ("Объясни эту страницу", "Что делать дальше?", "Покажи
туториал") — the panel offers a searchable catalog of 13 generic scripted
questions and a free-text box, but no verb-first action rail. Expensive LLM
routes (`/converse`, `/insight`) are rate-limited **by IP, not per-user** (the
follow-up flagged in memory), so a shared office IP throttles all colleagues and
a single user behind a rotating IP is unbounded. There is **no retention job**
for `assistant_events` despite the migration promising a 90-day cleanup, and no
per-answer quality/feedback loop wired into the chat thread (the `/feedback`
endpoint exists but the chat UI never calls it). The manual-insight failure copy
is hardcoded to «Гри» and ignores the chosen character.

Net: solid, safe foundation; ship a page-context + progress-aware upgrade, a
quick-command rail, per-user throttling, feedback capture, and a retention job.

---

## 2. Current implementation map

### 2.1 Entry / mounting
- Mounted in **two** layouts via `components/assistant/mascot/MascotLauncher.tsx`:
  `app/(dashboard)/layout.tsx:35` and `app/client/layout.tsx:9`.
- Kill-switch: `NEXT_PUBLIC_FEATURE_MASCOT='0'` → falls back to the static
  `AssistantChatLauncher` (`MascotLauncher.tsx:41`). Error boundary catches a
  mascot crash and also falls back (`MascotLauncher.tsx:23-38`).
- Lazy `next/dynamic` (`ssr:false`) so the cat never blocks first paint.

### 2.2 Orchestrator (client)
- `components/assistant/mascot/MascotAssistant.tsx` (803 lines) owns the whole
  lifecycle: polls `GET /api/v1/assistant/context` on navigation
  (`:175-206`), merges server hint candidates with local ones (greeting, idle,
  education, celebrate, welcome_back), runs the pure trigger engine
  (`pickHint`), renders avatar + bubble + controls + coachmarks. Hard DOM
  anti-annoyance blocks: typing target, foreign modal, on-screen keyboard,
  FirstRunWizard, scrolling, hidden tab (`:62-102, :208-308`).
- Auto AI-insight: once per session, after **75 s** on a results screen, only if
  `behavior.aiInsights` and a diagnostic exists (`:49-60, :536-552`).

### 2.3 Chat UI
- `components/assistant/AssistantChatPanel.tsx` (789 lines): slide-over, RU/EN,
  page-scoped quick questions + search + hamburger (all ⇄ this page), a
  multi-turn thread (client-side memory only, lost on reload), and a footer with
  **three** actions: `[Спросить Гри]`→`/converse`, `[Инсайт]`→`/insight`,
  `[Эксперт]`→`/escalate` (`:298-439, :698-755`).

### 2.4 API endpoints (`app/api/v1/assistant/*`)
| Route | Purpose | LLM | Rate limit |
| --- | --- | --- | --- |
| `POST /converse` | multi-turn chat turn | yes (`converseWithGree`) | **IP** 10/min |
| `POST /ask` | single-shot free-text Q&A | yes (`answerUserQuestion`) | **user** 15/min |
| `POST /insight` | one screen insight | yes (`buildScreenInsight`) | **IP** 6/hour |
| `POST /chat` | hydrate a scripted quick-question | no (deterministic) | none |
| `POST /analyze` | Layer-3 situational analysis | yes | user 6/min |
| `GET /context` | trigger data (no LLM) | no | IP 30/min |
| `GET /status` | persisted snapshot | no | — |
| `POST /escalate` | open ExpertCase | no | **none** |
| `POST /events` | batched analytics | no | IP 30/min |
| `POST /feedback` | up/down on a message/hint | no | IP 10/min |
| `GET/PATCH /settings`, `POST /hide`, `POST /validate` | settings/utility | no | IP |

### 2.5 Model & routing
- All LLM via **OpenRouter** (`lib/ai/openrouter.ts` → `chatWithOpenRouter`),
  wrapped by `generateObjectViaOpenRouter` (`lib/ai/structured.ts`, Zod + 1
  retry). Tiers: `fast`=Haiku 4.5, `smart`=Sonnet 4.5, `max`=Opus 4.1.
  - `/converse` and `/ask`: `complexity:'high'` → **Sonnet 4.5**, maxTokens 700.
  - `/insight`: `complexity:'low'` → **Haiku 4.5**, maxTokens 300.

### 2.6 Context passed to the model
- Built by `lib/assistant/context.ts` `buildAssistantContext(userId, sb)` —
  RLS-scoped, IDOR-safe (identity from cookie session only). Serialized by
  `serializeSnapshot()` (`lib/assistant/answer.ts:127-179`): company, Point A
  blocks/risks/gaps, Point B goal/gap/realism/data-sufficiency/levers, GRI
  index + top-5 limits, canonical revenue, and 6 whitelisted qualitative survey
  answers (PII-masked via `sanitizeQualitative`).
- **NOT in the snapshot**: current screen/route; survey completion %
  (`progress`) — computed only in `/context`, never handed to the chat model.

### 2.7 Persona / prompts
- `lib/assistant/mascot/system-prompt.ts` `mascotPersona(locale, characterId)` —
  persona line + hard safety block (prompt-injection defense, no-secrets,
  no-guarantees, escalate-hard-questions).
- Chat scope police + JSON contract live in `gree-chat.ts:80-107`; single-shot
  honesty rules in `answer.ts:47-79`; insight focus map in
  `insight.ts:33-90`.

### 2.8 Safety / guards
- `lib/assistant/mascot/output-filter.ts` redacts secret-shaped substrings,
  strips HTML/script, caps 2500 chars — runs on every model answer server-side.
- `lib/assistant/mascot/sanitize.ts` `maskPii` / `sanitizeQualitative` mask
  emails/phones/links before user text enters a prompt.
- History (`gree-chat.ts prepareHistory`): 8 turns, 600 char/turn, 3200 total.
- Analytics: `assistant_events` (migration 038) — event type/screen/ref_id +
  numeric/flag meta only; **no texts** (Langfuse holds traces). RLS: own + staff
  read, immutable, service-role delete.

---

## 3. Findings

Severity ∈ Critical / High / Medium / Low.

| ID | Sev | Issue | Evidence (file:line) | Fix / Improvement | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| GRI-01 | High | Chat LLM is **page-blind** — the current screen is passed to `/converse` in the body but never enters the prompt, so "объясни эту страницу"/"что здесь" answers ignore where the user is. `gree-chat.ts` and `answer.ts` never reference `screen`. | `app/api/v1/assistant/converse/route.ts:39,74`; `lib/assistant/gree-chat.ts:109-136` (no `screen`); `lib/assistant/answer.ts:185-216` (no `screen`) | Thread `screen` through `converseWithGree`/`answerUserQuestion`; add a `SCREEN_CONTEXT` block (what this page shows + its focus) to the user prompt, reusing `SCREEN_FOCUS`/`SCREEN_TIPS`. | Asking "что на этой странице?" on `/gri` returns a GRI-specific answer referencing the index/top-limits; same question on `/point-b` references goal/realism. Verified on 4 screens. |
| GRI-02 | High | Chat LLM is **progress-blind** — survey completion %/next section is computed in `/context` (`computeCompletion`) but is NOT in `AssistantContext`, so "итог моего прогресса"/"что делать дальше" can't cite how far the user is. | `lib/assistant/context.ts:270-289` (no `progress`); `app/api/v1/assistant/context/route.ts:41-49` (completion computed but not fed to chat) | Add `progress {completionPct, completedSections, totalSections, nextSection, status}` to `AssistantContext`; serialize it into the snapshot. | Asking "какой мой прогресс?" returns "заполнено N/12 разделов, дальше — «X»"; grounded in real completion, escalates when 0%. |
| GRI-03 | High | Expensive LLM routes throttled **by IP, not per-user** — a shared office/NAT IP throttles all colleagues; a user behind rotating IPs is unbounded. Memory flags per-user rate-limit as the open follow-up. `/ask` and `/analyze` already use `isRateLimitedKey(user.id,…)`; `/converse` and `/insight` do not. | `app/api/v1/assistant/converse/route.ts:48` (`isRateLimited(req,…)`); `app/api/v1/assistant/insight/route.ts:30` (`isRateLimited(req,…)`); cf. correct pattern `app/api/v1/assistant/ask/route.ts:46` | Switch `/converse` and `/insight` to `isRateLimitedKey(user.id, …)`. Keep IP limit as a second layer if desired. | Two users on one IP each get their own quota; a single user cannot exceed the per-user cap by changing IP. Unit/integration test per user. |
| GRI-04 | High | **No quick-action command rail** — the panel offers 13 generic scripted questions + free text, but none of the requested verb-first commands ("Объясни эту страницу", "Что делать дальше?", "Покажи туториал для этой страницы", "Найди инструмент", "Итог прогресса", "Помоги исправить ошибку", "Рекомендуй следующий шаг", "Поиск", "Объясни виджеты", "Проведи по настройке"). | `components/assistant/AssistantChatPanel.tsx:698-752` (only 3 footer buttons); `lib/assistant/chat-scripts.ts` (13 topic scripts, not actions) | Add a `QuickActions` rail (chips) at the top of the thread; each maps to a handler (LLM w/ page+progress context, a tour, or navigation). See §5.1. | The 10 named commands are present and each returns a page-relevant, grounded result or launches the right tour/route. Measured via new analytics event `quick_action_used`. |
| GRI-05 | Medium | **No feedback loop in chat** — `/feedback` (up/down) exists but `AssistantChatPanel` never calls it, so answer quality is unmeasured and untunable. | `app/api/v1/assistant/feedback/route.ts` (exists); `AssistantChatPanel.tsx:618-670` (no thumbs on Гри messages) | Add 👍/👎 to each `role:'gree'` free/insight message → `POST /feedback {target:'message', rating}`. | Every Гри chat answer shows up/down; a click writes `type='feedback'` to `assistant_events`; a dashboard can compute helpful-rate. |
| GRI-06 | Medium | **No retention job** for `assistant_events` — migration 038 promises "90-day retention cleanup (service role)", but no cron/Inngest function deletes rows. Table grows unbounded. | `supabase/migrations/038_assistant_events.sql:16-17,80-82`; no match for a delete/retention job across `lib/functions`, `app/api` | Add a scheduled Inngest/cron function deleting `assistant_events` older than 90 days via the service role. | Rows older than 90 days are removed on schedule; job is idempotent and logs a count. |
| GRI-07 | Medium | **Insight snapshot doesn't vary by screen** — `buildScreenInsight` changes only the one-line *focus*; the serialized data (`serializeForInsight`) is identical on every screen, so a `/metrics` insight and a `/point-b` insight see the same fields and can drift off-topic. | `lib/assistant/mascot/insight.ts:47-90` (`serializeForInsight` ignores `screen`; only `focus` differs) | Emphasize the screen-relevant slice (e.g. on `/point-b` lead with gap/realism; on `/metrics` lead with revenue/data gaps) and bump `INSIGHT_PROMPT_VERSION`. | Insight text on each results screen visibly foregrounds that screen's metric; A/B measured by `hint_clicked` on `ai_insight`. |
| GRI-08 | Medium | **Manual-insight failure copy is persona-blind** — hardcoded "…я вернусь с наблюдением 🐾" always says Гри's voice even when the user picked Арчи/Капи/Ума. | `components/assistant/mascot/MascotAssistant.tsx:511-514` | Use the chosen character's name/voice (already available via `getCharacter(settings.character)`), mirror the panel's `insightFail`. | Manual-insight fallback bubble uses the selected character's name; verified for all 4 skins. |
| GRI-09 | Medium | **No knowledge base of the platform itself** — the model only knows the *user's* snapshot, not how AIStart360 works (where a feature lives, what a widget means, how to run a diagnostic). "Найди нужный инструмент" / "объясни виджеты" have no grounding source. | `serializeSnapshot` = user data only (`answer.ts:127-179`); persona mentions features but no navigable KB | Add a small static RU knowledge base (routes, feature blurbs, widget glossary, "how-to" steps) injected on-demand for navigational/how-to intents. See §5.4. | "Где посмотреть анализ рынка?" returns the correct route + one-line what-it-is; answer cites the KB, never invents a route. |
| GRI-10 | Low | **`/escalate` has no rate limit** — unlike every other assistant route, the expert-case opener is unthrottled; a script could spam ExpertCases/admin notifications. | `app/api/v1/assistant/escalate/route.ts:34-79` (no `isRateLimited*`) | Add `isRateLimitedKey(user.id, 'assistant-escalate', {max:5, windowMs:60_000})`. | 6th escalation within a minute returns 429; legitimate single escalations unaffected. |
| GRI-11 | Low | **Chat thread is ephemeral** — client-only memory, lost on reload/navigation; no server persistence and no "continue where we left off". Deliberate for privacy, but it means the assistant has no long-term memory of the user. | `AssistantChatPanel.tsx:191` (`useState<ChatMsg[]>([])`); `converse/route.ts:16-24` doc "nothing persists server-side" | Optionally persist a short, PII-masked rolling summary per user (opt-in), or at least session-storage the thread so a reload doesn't wipe it. | With the toggle on, a reload restores the visible thread; safety filters still apply; off by default. |
| GRI-12 | Low | **Tours are static single-anchor** on most screens (just `h1` + the mascot step); no tour ties to specific dashboard widgets, so "объясни виджеты дашборда" has thin coverage beyond `/dashboard`'s 3 anchors. | `lib/assistant/mascot/tours.ts:26-125` (many screens = `h1` + `MASCOT_STEP`) | Expand tours to anchor real widgets (`#gri-dial`, `#top-limits`, `#realism-badge`, KPI cards) with 1-line explanations; keep silent-skip on missing selectors. | Each results screen tour has ≥3 real anchored steps; a missing selector is skipped without breaking the tour. |
| GRI-13 | Low | **No latency budget on the "smart" chat tier** — `/converse` uses Sonnet 4.5 (measured ~11–23 s) with the default 45 s OpenRouter timeout; a slow turn feels dead beyond the typing indicator. | `lib/assistant/gree-chat.ts:161` (`complexity:'high'`); `openrouter.ts:133` (default 45 s) | Consider Haiku for short/nav intents (intent-route), pass a tighter `timeoutMs` (e.g. 20 s) for chat, and show a "долго думаю…" nudge after ~8 s. | p50 chat turn < 6 s for short questions; a >8 s turn shows the extended-wait nudge; no turn hangs past 20 s. |
| GRI-14 | Low | **`/analyze` (Layer-3) is unused by the mascot chat** — a richer situational analysis exists but the panel never surfaces it; "рекомендуй следующий шаг" leans on the thinner snapshot only. | `app/api/v1/assistant/analyze/route.ts`; not referenced in `AssistantChatPanel.tsx` | Wire a "Рекомендуй следующий шаг" quick action to `/analyze` (or fold its output into the converse context when fresh). | The action returns a prioritized next-step recommendation grounded in Layer-3 analysis; falls back to snapshot when analysis is stale/absent. |

---

## 4. Strengths worth preserving (do not regress)

- Single curated, RLS-scoped snapshot as the ONLY LLM fact source; `null`-honest
  degradation; escalate-not-fabricate contract.
- Prompt-injection defense + secret output-filter + PII masking (defense in depth).
- Anti-annoyance trigger engine with cooldowns, session caps, frequency modes,
  and DOM hard-blocks (typing/modal/keyboard/scroll/wizard).
- Character skins that change only persona line + avatar, never safety rules.
- Analytics stored without texts; feature kill-switch + crash error-boundary.

---

## 5. Improved «Гри» specification

### 5.1 Quick-action command rail (GRI-04)
Render as chips at the top of the chat thread (and 3–4 top ones inline in the
bubble menu). Each maps to a handler; all LLM handlers receive **page + progress
context** (§5.2). Localize; default RU.

| Command (RU) | Handler | Grounding |
| --- | --- | --- |
| Объясни эту страницу | LLM `/converse` intent=`explain_page` | screen KB blurb + snapshot |
| Что делать дальше? | LLM `/converse` intent=`next_step` | progress + weakest block/gap |
| Покажи туториал для этой страницы | launch `tourForScreen(screen)` | tours.ts |
| Найди нужный инструмент | LLM + KB nav (intent=`find_tool`) | KB routes (§5.4) |
| Итог моего прогресса | LLM intent=`progress_summary` | progress + results |
| Помоги исправить ошибку | LLM intent=`fix_error`, pull `runValidation` issues | validators |
| Рекомендуй следующий шаг | `/analyze` → prioritized step (GRI-14) | Layer-3 + snapshot |
| Поиск внутри AIStart360 | KB search over routes/features | KB |
| Объясни виджеты дашборда | screen-scoped tour or LLM widget glossary | tours + KB glossary |
| Проведи меня по настройке | multi-step onboarding tour / checklist | tours + progress |

Availability is screen-aware: show "Покажи туториал" only when `tourForScreen`
exists; "Объясни виджеты" only on `/dashboard`; "Помоги исправить ошибку" only
when `/context.errorCount > 0`.

### 5.2 Context to add to the chat prompt (GRI-01, GRI-02)
Extend `AssistantContext` with `progress` and thread `screen` into
`converseWithGree`/`answerUserQuestion`. Add to the user prompt:

```
--- ТЕКУЩИЙ ЭКРАН ---
Экран: {screen} — {SCREEN_FOCUS[screen] или общий}
Что показывает: {KB blurb для экрана}

--- ПРОГРЕСС ДИАГНОСТИКИ ---
Заполнено разделов: {completedSections}/{totalSections} ({completionPct}%)
Следующий раздел: {nextSection.label или «—»} · Статус: {status}
```

### 5.3 System-prompt additions (concrete RU text)
Append to `mascotPersona`/chat system prompt:

```
КОНТЕКСТ ЭКРАНА: тебе передаётся текущий экран пользователя и что он показывает.
Если вопрос про «эту страницу», «здесь», «этот виджет» — отвечай про текущий
экран, а не в общем.

ПРОГРЕСС: тебе передан прогресс диагностики. На вопросы «что дальше / мой итог»
опирайся на реальный процент и следующий незаполненный раздел; не выдумывай.

ДЕЙСТВЕННОСТЬ: заканчивай ОДНИМ конкретным шагом с указанием, ГДЕ в интерфейсе
это сделать (раздел/кнопка), если знаешь из базы знаний платформы. Если не
знаешь маршрут — не выдумывай его, предложи открыть меню/поиск.
```

For `find_tool`/`explain_page` intents, prepend the relevant KB slice and add:

```
Если вопрос навигационный («где найти…», «как открыть…») — используй ТОЛЬКО
маршруты из базы знаний ниже. Никогда не придумывай несуществующий раздел.
```

Bump `INSIGHT_PROMPT_VERSION` / a `GREE_PROMPT_VERSION` constant on every prompt
change so drift is detectable downstream.

### 5.4 Knowledge base (GRI-09)
Static RU module `lib/assistant/mascot/knowledge-base.ts`:
- `ROUTES`: `{ route, label, whatItIs, whenToUse }` for every user-facing page
  (dashboard, onboarding, gri, pulse, point-a, point-b, metrics, market,
  action-plan, insights, settings).
- `WIDGET_GLOSSARY`: `{ id, label, meaning }` for dashboard widgets (GRI dial,
  top-limits, KPI cards, realism badge, market TAM/SAM/SOM).
- `HOWTO`: short numbered steps for "запустить диагностику", "загрузить отчёт",
  "получить GRI", "поставить цель (Точка B)".
Injected only for navigational/how-to intents to keep token cost down. Never a
source of *numbers* — those still come only from the snapshot.

### 5.5 Personalization & recommendations
- Address by chosen character voice everywhere (fix GRI-08).
- Progress-aware nudges already exist (celebrate); extend "Рекомендуй следующий
  шаг" to use `/analyze` (GRI-14) for a prioritized, snapshot-grounded action.
- Weakest-block / top-limit aware default suggestions on results screens.

### 5.6 Error explanation (GRI-04 «Помоги исправить ошибку»)
Handler pulls `runValidation(ctx,{includeLlm:false})` issues, feeds the top
`error`-severity ones to the LLM with a "объясни простыми словами и подскажи, в
каком разделе исправить" instruction. Grounded in real validator output; no
invented contradictions.

### 5.7 Fallback behavior (keep + extend)
- No key / failure / low-confidence / off-topic → escalate to expert (existing).
- Add: on `null` insight, use character-specific copy; on slow turn (>8 s) show
  "долго думаю…"; on rate-limit (429) show a friendly "чуть позже" line, not the
  generic answerFailed.

### 5.8 UI / placement / mobile (audit of current, keep)
- Desktop cat 126px bottom-right, strolls/sleeps; mobile 64px, no walking,
  hidden when on-screen keyboard open (`useSafeScreenPosition`). Panel is a full
  slide-over `max-w-md`, `role=dialog aria-modal`. Reduced-motion respected.
- Add: quick-action chips must be horizontally scrollable on mobile; keep the 3
  footer buttons.

### 5.9 Safety rules (unchanged, reaffirm)
Prompt-injection defense, no-secrets, no-guarantees, escalate-hard-questions,
output secret-filter, PII masking, plain-text rendering. New KB must NOT carry
secrets or internal routes (admin/giga) — user-facing routes only.

### 5.10 Quality checks
- Zod-validate every LLM shape (existing). Add golden tests: page-context and
  progress prompts render expected blocks; KB nav answers never emit an
  off-list route; persona name matches selected character in all fallbacks.

### 5.11 Analytics to measure usefulness
Extend the `assistant_events` vocabulary (server whitelist) + client tracker:
- `quick_action_used` (refId = action id) — adoption of the new rail.
- `feedback` up/down per message (GRI-05) → **helpful-rate** KPI.
- `answer_received` already carries `latency_ms`, `insufficient`, `escalated`;
  add `intent` (explain_page/next_step/…) to segment usefulness by command.
- `tour_started` / `tour_completed` for the tutorial link (GRI-04 tour action).
- Dashboard: helpful-rate, escalation-rate, quick-action CTR, p50/p95 latency,
  insufficient-data rate per screen.

---

## 6. Integration plan (pages ↔ tutorial system)
1. Extend `AssistantContext` (+progress) and thread `screen` — enables GRI-01/02
   for `/converse`, `/ask`, and the new quick actions. No new deps.
2. Add `knowledge-base.ts` + intent routing in `gree-chat.ts`.
3. Add `QuickActions` chip rail in `AssistantChatPanel`; wire tour action to the
   existing `tourForScreen` / `aistart:tutorial:replay` event already used by
   `MascotAssistant` (`:575-590`).
4. Per-user rate-limit swap on `/converse`,`/insight`; add `/escalate` limit.
5. Add 👍/👎 + `/feedback` call; extend events whitelist + tracker.
6. Add retention Inngest/cron for `assistant_events` (90 days).
7. Expand tours to widget anchors; bump prompt-version constants.

---

## 7. Acceptance criteria (per capability)
- **Page context**: same question on 4 screens yields screen-specific, grounded
  answers; nav questions cite only real routes.
- **Progress awareness**: "мой прогресс" cites real N/total and next section;
  escalates at 0%.
- **Quick actions**: all 10 named commands present, each returns a relevant
  grounded result or launches the correct tour/route; adoption tracked.
- **Per-user throttle**: two users on one IP each keep their quota; IP rotation
  can't bypass the per-user cap.
- **Feedback loop**: every Гри answer has up/down; clicks land in
  `assistant_events`; helpful-rate computable.
- **Retention**: >90-day events removed on schedule; idempotent, logged.
- **Persona**: all fallback copy uses the selected character's name/voice.
- **KB**: navigational answers never invent a route; how-to steps match reality.
- **Latency**: short turns p50 < 6 s; >8 s shows nudge; no hang past 20 s.

---

## 8. Product-owner questions
1. **Memory vs privacy (GRI-11)**: keep chat purely ephemeral, or add an opt-in
   PII-masked rolling summary so «Гри» remembers past sessions?
2. **Cost ceiling (GRI-03/13)**: what per-user daily budget for LLM chat/insight?
   Should short/nav intents route to Haiku to cut cost/latency?
3. **KB ownership (GRI-09)**: who maintains the platform knowledge base (routes,
   widget glossary, how-tos) as the product evolves?
4. **Quick-action set (GRI-04)**: are the 10 named commands the final list, or do
   you want to add domain ones (e.g. "Сравни меня с рынком", "Объясни мой GRI")?
5. **Escalation volume (GRI-10/14)**: is a 5/min escalation cap acceptable, and
   should "Рекомендуй следующий шаг" trigger the costly `/analyze` on demand?
6. **Tours depth (GRI-12)**: invest in per-widget anchored tours on every results
   screen, or keep lightweight `h1`-level tours?
