# 08 — World Monitor Feature Parity (clean-room)

> Written 2026-05-28 by `system-architect` on the founder's ask: "take all features from Pro-Monitor".
>
> **Pro-Monitor** in this repo = **[koala73/worldmonitor](https://github.com/koala73/worldmonitor)** + its commercial tier landing at **[worldmonitor.app/pro](https://www.worldmonitor.app/pro)**. License: **AGPL-3.0-only**.
>
> This document is a **clean-room feature spec**. It was authored by reading ONLY:
>
> - the public README on the GitHub repo home page,
> - the public marketing page at `worldmonitor.app/pro`.
>
> **No source files** from World Monitor were read by the author. **No source files** are to be read by any implementing agent. Agents who need context get this document and our own codebase — nothing else.
>
> Why this matters: World Monitor is AGPL-3.0. Reading and re-expressing its source — even with renames — produces a derivative work and forces our codebase under AGPL too, killing our SaaS-proprietary model. Reading their *public docs* and re-implementing the *behavior* with fresh code is the standard clean-room methodology and is legally distinct.
>
> Pairs with `docs/aistart360/07-product-redesign.md` (the 90-day blueprint that sets persona = BD lead) and `docs/11-roadmap.md`.

---

## 1. TL;DR

- World Monitor's value prop is **global situational awareness** (geopolitics, finance, satellite, flight). Mark-analytics' value prop is **KZ company / market intelligence for BD leads**.
- Many WM features are mis-fit for our persona — globe.gl 3D maps, 92 stock exchanges, flight data, geopolitical Grand-Chessboard framework, etc. We are not building "Bloomberg for the world".
- BUT several WM patterns translate directly into our roadmap: **AI Analyst chat**, **scheduled AI Digest** (daily/weekly), **multi-channel notifications** (Slack/Discord/Webhook on top of our planned Email/Telegram), **alert rules with quiet hours**, **MCP connector** to expose our API to Claude/GPT, **custom widget builder**, **composite regional risk index** for the map.
- This doc lists everything WM advertises, marks `fit` / `partial` / `skip` for our product, and turns the `fit` items into concrete implementation tracks that map onto our existing Sprint 3–6 plan.

---

## 2. Source material (what we read)

| Source | URL | What it gave us |
|--------|-----|-----------------|
| GitHub README | https://github.com/koala73/worldmonitor | License, tech stack, top-level feature bullets, screenshot description |
| Pro marketing page | https://www.worldmonitor.app/pro | Pricing tiers, notification channels, "30+ live services" list, WM Analyst / AI Digest / Custom Widget Builder positioning |

No further reads of WM repository contents are sanctioned for this project. If an implementer is tempted to look at a `.ts` file from `koala73/worldmonitor` to "see how they did it" — stop, write the question down, file it as a doc gap here.

---

## 3. Full feature inventory

Verbatim feature claims from the two public sources, normalised. The `fit` column is our editorial call against the BD-lead persona from `07-product-redesign.md` §3.

### 3.1 Data & dashboards

| WM claim | Fit for Mark-analytics | Notes |
|----------|-----------------------|-------|
| 500+ curated news feeds across 15 categories | partial | We need ~10 KZ/CIS business feeds, not 500 global. Already scoped as Phase-2 spider in `07-product-redesign.md` §7. |
| Cross-stream correlation across military / economic / disaster / escalation signals | skip | Off-persona. BD lead doesn't care about military escalation. |
| Country Intelligence Index — composite risk score, 12 signal categories | partial → **fit** | Re-cast as **KZ Region Risk Index**: composite per-region score from local data (registrations growth, court cases, sanctions hits, complaints). Becomes a new metric for `RegionChoropleth`. |
| Finance radar: 92 stock exchanges, commodities, crypto, 7-signal market composite | skip | We already have a KZ-scoped `MarketTickerWidget` showing KASE + USD/KZT + a few commodities. Don't expand to 92 exchanges. |
| 65+ external data sources aggregated | partial | We will land 5–8 KZ sources (`07-product-redesign.md` §6). 65 is a vanity number, not a goal. |
| 21 languages with native feeds + RTL | skip | We already have ru/kz/en. RTL not in market. |
| Dual map engine (3D globe + flat WebGL) | skip | Flat deck.gl is in. 3D globe adds zero BD-lead value for KZ-only territory. |
| Native desktop app (Tauri 2) for macOS/Win/Linux | skip | Web-first. Revisit at GA. |
| Flight data integration | skip | Off-persona. |
| 5 site variants from single codebase | skip | We have one product. |

### 3.2 AI features

| WM claim | Fit | Notes |
|----------|-----|-------|
| **WM Analyst Chat** — "query all 30+ services conversationally" | **fit** | Our analogue: **MK Analyst** — a chat UI over the companies / tenders / analytics endpoints. Routes NL questions ("сколько IT-компаний в Алматы выросли в 2025") through our existing AI Gateway with function-calling to our REST endpoints. See §5 Track A. |
| **AI Digest** — daily / twice-daily / weekly delivery, 30 ranked items | **fit** | Maps to a new `DigestJob` running on Arq; collects new+changed entities matching user's saved filters, ranks by signal strength, sends through notification channel. See §5 Track B. |
| AI-synthesized news briefs | partial | Wait for the news spider (§3.4 below). Don't ship hand-wavy summaries off thin data. |
| Local AI via Ollama (no API keys required) | skip | Our AI Gateway is cloud-routed (`docs/adr/0001-no-local-gpu.md`). Local Ollama on user devices is out of scope. |
| AI-assisted **Custom Widget Builder** (HTML/CSS/JS) | **fit (now, config-driven)** | Founder pulled this forward 2026-05-28. We DON'T ship HTML/CSS/JS panels (XSS surface, wrong persona — see §5 Track G rationale). We ship a **config-driven** builder: 6 widget types, JSON-schema params, AI-assisted form fill via NL prompt. See §5 Track G. |

### 3.3 Alerts & notifications

| WM claim | Fit | Notes |
|----------|-----|-------|
| Alert Rules Engine with quiet hours | **fit** | Extends our planned `AlertRule` (Sprint 3): add `quiet_hours_start`, `quiet_hours_end`, `timezone`. See §5 Track C. |
| AES-256 encrypted webhook delivery | **fit** | Adds `webhook_secret` + HMAC SHA-256 signature header (industry standard, simpler than full AES roundtrip — see §5 Track C for justification). |
| Slack / Discord / Telegram / Email / Webhook channels | **fit** | We have Email + Telegram in plan. Add Slack incoming-webhook, Discord webhook, generic outbound webhook. See §5 Track C. |
| Market Watchlist (equity portfolio) | partial → **fit** | We re-cast as **Saved Companies list** (BD lead's "ICP list"). Already partially scoped in `07-product-redesign.md` §4 as the Directory's bulk-select. Promote to first-class persistent list. |

### 3.4 Integrations & API

| WM claim | Fit | Notes |
|----------|-----|-------|
| **MCP Connectors** (Claude, GPT, custom LLMs) | **fit** | Build a small **`mark-analytics-mcp`** server exposing 5–8 read-only tools (`search_companies`, `get_company`, `get_tenders`, `get_industry_overview`, `get_region_summary`, `get_forecast`) so users can query our data from Claude Desktop / Cursor / their own agent stack. See §5 Track D. High signalling value, low build cost. |
| Protocol Buffers API (92 protos, 22 services) | skip | We are REST + OpenAPI. Don't introduce protobuf for an internal aesthetic gain. |
| Vercel Edge Functions | skip | Our deploy target is Railway + Fly. |
| Public API (Enterprise tier) | partial | Already in `docs/10-api-contract.md` for paid tier; not a new feature, just gate the existing one. |

### 3.5 Pricing

| WM tier | Our analogue |
|---------|--------------|
| Free — core dashboard, 500+ feeds | Free — read-only Directory, heuristic insights, 1 saved filter, no alerts |
| Pro — $39.99/mo or $399.99/yr | Pro — alerts (≤10), digest, CSV export, MK Analyst chat (cap), saved company lists |
| Enterprise — team / APIs / TV apps / managed | Business — orgs, public API, higher quotas (already in `00-product-vision.md` §3) |

Pricing decisions stay where they live (`00-product-vision.md` §3 + `07-product-redesign.md` §10). This table is *parity*, not a re-decision.

---

## 4. What we explicitly are NOT doing

To prevent scope creep when an implementer says "but WM has it…", the explicit no-list:

- ❌ Globe.gl / 3D map. Deck.gl flat stays.
- ❌ 92 stock exchanges. KASE + 3 commodities stays.
- ❌ Flight data. Off-persona.
- ❌ Geopolitical frameworks ("Grand Chessboard", "Prisoners of Geography"). Off-persona.
- ❌ Ollama / local LLM. We route through our AI Gateway only (ADR-0001).
- ❌ Native desktop app (Tauri). Web-first.
- ❌ Protocol Buffers. We are REST + OpenAPI.
- ❌ "65+ data sources" for vanity. Quality over count (`07-product-redesign.md` §6).
- ❌ Cross-stream correlation across military / disaster signals. We track *companies*, not *crises*.

If any of those becomes a real customer request later, re-open *this section* before re-opening the feature.

---

## 5. Implementation tracks (clean-room)

Each track is a self-contained spec. Implementing agents read **only this document plus our own codebase**, never the WM source.

### Track A — MK Analyst chat

**Goal**: BD lead can type "какие IT-компании в Алматы выросли за квартал" and get a ranked answer with links to entity profiles.

**Surface**:
- New frontend route `/analyst` (or a slide-in drawer on the index page — pick whichever fits the current shell better; bias to drawer for now to avoid routing churn).
- Backend endpoint `POST /api/v1/analyst/query` with body `{ query: string, conversation_id?: string }`.
- Returns streaming response (SSE) with assistant text + a sidecar `actions: [{type: "open_company", id: ...}, {type: "apply_filter", filters: {...}}]` list.

**Backend shape**:
- New service `app/services/analyst.py`. Routes NL query through the AI Gateway with function-calling enabled, exposing internal tools `search_companies`, `get_company`, `industry_overview`, `region_overview`, `recent_tenders`. Each tool is a thin wrapper around an existing endpoint or service.
- Conversation history kept in Redis under `analyst:conv:{id}` with TTL 24h. No DB persistence for v1.
- AI calls counted against the same quota envelope from §9 of `07-product-redesign.md`.

**Frontend shape**:
- `frontend/src/components/analyst/AnalystDrawer.tsx` — Radix dialog/sheet with a message list and a textarea. Bubble UI from our existing design tokens.
- When the response includes `actions`, render them as inline chips: clicking a `open_company` chip selects the company in the map store; clicking `apply_filter` sets the directoryFilter store.

**Out of scope**: voice input, image uploads, persistent conversation history, multi-turn agent tools beyond the 5 enumerated.

**Effort**: M (one backend agent + one frontend agent, ~1 sprint).

### Track B — AI Digest job

**Goal**: User picks "Daily 09:00" and a saved filter; every morning gets a brief in their chosen channel with up to 20 ranked new+changed entities.

**Surface**:
- DB: new table `digest_subscriptions(id, user_id, filter_id, channel, schedule_cron, last_run_at, active)`.
- DB: new table `digest_runs(id, subscription_id, started_at, finished_at, item_count, error)`.
- Backend endpoints: `POST/GET/PATCH/DELETE /api/v1/digests`.
- Arq job `digest_runner` ticks every 5 min, picks subscriptions whose cron is due.

**Ranking**:
- Pull entities matching the filter changed since `last_run_at`.
- Score: `0.4 * recency + 0.3 * size_bucket_weight + 0.2 * change_significance + 0.1 * subscription_match_strength`.
- Cap at 20 items. If zero, send empty-state message (configurable: skip vs. send).

**Body**:
- Render Markdown body via LLM with strict instruction: title (5–7 words), 1-line description per item, link to entity. Validate the AI output JSON-schema — drop and fall back to non-AI template on parse fail.

**Effort**: M.

### Track C — Multi-channel alerts + quiet hours

**Goal**: Existing `AlertRule` (planned Sprint 3) gains Slack/Discord/Webhook delivery and per-rule quiet hours.

**Backend changes**:
- `AlertRule` adds: `quiet_hours_start: time | null`, `quiet_hours_end: time | null`, `timezone: str` (IANA), `channel_kind: enum`, `channel_config: jsonb`.
- New deliverers in `app/notifications/`: `slack.py` (incoming webhook URL), `discord.py` (webhook URL), `webhook.py` (POST JSON + HMAC-SHA-256 header `X-MK-Signature`).
- HMAC secret stored in `channel_config.secret` (per-rule), generated server-side on rule creation.

**Decision: HMAC vs. AES**. WM advertises "AES-256 encrypted webhook". For our threat model, payload-integrity signing (HMAC) is the right tool — AES requires shared keys, key rotation, and a reason the *contents* must be confidential even on TLS, which isn't justified for our digest payloads. Document this in the rule UI: "Webhook is signed (HMAC-SHA-256). Verify the `X-MK-Signature` header." Don't pretend we have AES.

**Quiet hours**:
- If now-in-timezone falls within quiet hours, enqueue the alert into a `pending_alerts` table for delivery at quiet-end. Don't drop, don't deduplicate aggressively (BD lead wants every match, just batched).

**Effort**: S–M.

### Track D — MK MCP server

**Goal**: Power users can `mcp-add mark-analytics` in Claude Desktop and ask Claude "find me SaaS companies in Astana with > 100 employees" — Claude calls our MCP tools, our server queries the same API, returns structured JSON.

**Shape**:
- Standalone Python package `mark-analytics-mcp/` (separate package so it can be `pipx install`-ed without dragging the FastAPI app).
- Implements MCP server protocol (stdio for desktop clients; HTTP optional later).
- 5 read-only tools:
  - `search_companies(query, industry, region, size, limit)`
  - `get_company(id_or_bin)`
  - `get_recent_tenders(industry?, region?, limit?)`
  - `industry_overview(industry_code)`
  - `region_overview(kato_code)`
- Auth: user supplies their existing Mark-analytics API token via env var `MK_TOKEN`. Server passes it as `Authorization: Bearer` to our REST API. No DB access from MCP.
- Quota: MCP calls count as normal API calls against the user's plan (existing `users.requests_used`).

**Effort**: S. Whole thing is a thin wrapper; the value is the integration, not the code.

### Track E — Composite KZ Region Risk Index

**Goal**: A new metric on `RegionChoropleth` showing per-region risk score 0..100 (heat-mapped). BD lead sees "which oblasts have rising defaults, court cases, sanctioned residents" at a glance.

**Backend shape**:
- New view/MV `region_risk_index` with columns `kato_code`, `score`, `subscores: { liquidations_3m, court_cases_6m, sanctions_hits, complaints_count }`, `updated_at`.
- Recomputed nightly by an Arq job from the underlying tables (some of which don't yet exist — that's fine, default the missing inputs to 0 and document in the response that the score is degraded).
- New endpoint `GET /api/v1/regions/risk` returning the standard envelope.

**Frontend shape**:
- Add `risk` to `RegionMetric` in `frontend/src/stores/map.ts`. `MetricSelector` gets a new pill.
- `RegionChoropleth` color ramp for `risk` uses red-orange instead of indigo to differentiate.
- Region drawer (`RegionDrawer.tsx`) shows the subscore breakdown.

**Effort**: M. Depends on data — for v1 ship with whatever inputs are populated (probably just `complaints_count` and `liquidations`); document the rest as "coming".

### Track G — Custom dashboard with widget builder (config-driven, AI-assisted)

**Goal**: User opens the dashboard and sees *their own* set of widgets, not 7 hardcoded ones. They can add new widgets via a picker, configure each via a form (or via a natural-language prompt → LLM fills the form), drag/resize them (Phase 2 Track B already shipped this), and persist layout per user.

**Why config-driven, not HTML/CSS/JS**:
- WM's "HTML/CSS/JS panels with AI assistance" assumes a developer-leaning audience. Our BD persona doesn't write JS.
- Running user-authored JS in our browser context — even in an iframe sandbox — is a non-trivial threat-model expansion (postMessage abuse, cookie leak, CSP overrides, lifecycle DoS). We don't pay that cost for a feature 5% of users would use.
- LLMs are far better at filling structured JSON forms than at generating runnable JS — fewer hallucinations, easier validation, easier rollback.

**Six built-in widget types (v1)**:
1. **metric** — single big number from an analytics endpoint. Params: `metric_key`, `filter_ref?`, `format` (currency/integer/percent).
2. **list** — table of entities. Params: `data_source` (`companies` | `tenders` | `saved_list`), `filter_ref?`, `columns: string[]`, `sort`, `limit` (≤50).
3. **chart** — bar/pie/line. Params: `chart_kind`, `data_source` (`industry_distribution` | `region_distribution` | `size_distribution` | `growth_leaders`), `top_n`, `filter_ref?`.
4. **map_mini** — small map showing companies matching a filter. Params: `filter_ref`, `bbox` (optional, auto-fit if absent).
5. **news** — RSS feed slice. Params: `sources: string[]`, `keywords: string[]`, `limit`.
6. **note** — markdown text (user's own free-form note, no data binding). Params: `markdown`.

Adding more types later is a backend-only change (new entry in catalog + new frontend renderer).

**Widget registry (canonical catalog)**:
- Lives in `backend/app/widgets/catalog.py` as a Python dict — type-id → JSON schema for params, human-readable name, description, icon (lucide name), tier requirement.
- Exposed via `GET /api/v1/widgets/catalog` for the frontend picker.

**Per-user widgets storage**:
- New DB table:
  ```
  user_widgets(
    id uuid pk,
    user_id fk,
    widget_type text not null,     -- references catalog keys
    name text not null,             -- user-given label
    params jsonb not null,          -- validated against catalog schema on write
    layout jsonb,                   -- {x, y, w, h, breakpoint-overrides}
    sort_index int default 0,
    created_at, updated_at
  )
  ```
- Unique constraint on `(user_id, id)`. No global widget sharing in v1.

**Endpoints**:
- `GET /api/v1/widgets/catalog` — list of available types.
- `GET /api/v1/widgets` — current user's widgets, ordered by `sort_index`.
- `POST /api/v1/widgets` — create. Body validated against catalog schema for the requested `widget_type`.
- `PATCH /api/v1/widgets/{id}` — update params/name/layout.
- `DELETE /api/v1/widgets/{id}`.
- `POST /api/v1/widgets/ai-suggest` — body `{prompt: string, widget_type?: string}`, returns a *proposed* widget config (NOT auto-saved). Routes prompt through AI Gateway with JSON-schema-constrained generation for the chosen type (or has the LLM pick the type if not given). Validates output against catalog schema before returning; on failure, returns `{error: "ambiguous", reason}`.
- `POST /api/v1/widgets/{id}/data` — server-rendered data for the widget given its params (so the frontend doesn't need 6 different fetchers). Internally dispatches to the correct service.

**Frontend**:
- New page route `/dashboard` (or replace the default index) that fetches `/api/v1/widgets` instead of hardcoding the 7 widgets.
- Widget renderers per type at `frontend/src/components/widgets/types/`:
  - `MetricWidget.tsx`, `ListWidget.tsx`, `ChartWidget.tsx`, `MapMiniWidget.tsx`, `NewsWidget.tsx`, `NoteWidget.tsx`.
  - Each takes a widget config + uses a single `useWidgetData(id)` hook hitting `/api/v1/widgets/{id}/data`.
- **Widget picker modal** (`frontend/src/components/widget-builder/WidgetPicker.tsx`): grid of 6 cards (one per type), click → opens the editor.
- **Editor modal** (`frontend/src/components/widget-builder/WidgetEditor.tsx`):
  - Two-pane: form on left (auto-rendered from JSON schema using a small in-repo `JsonSchemaForm` component, NOT a 200KB external dep), live preview on right (calls the data endpoint with debounce).
  - "✨ Ask AI" button at top opens a textarea — user types NL prompt — POSTs to `/widgets/ai-suggest` — fills the form (user can review/edit before save).
  - "Save" creates the widget; "Cancel" discards.
- **Layout persistence**: the existing `react-grid-layout` instance from Phase 2 Track B saves layout to localStorage under `mk-widget-layout-v1`. Track G upgrades this to:
  - On first load with persisted widgets in DB → migrate localStorage layout to DB (`PATCH /widgets/{id}` for each).
  - From then on, layout changes write back to DB (debounced 500ms).
  - Reset button calls `DELETE`-then-reseed defaults.

**Defaults**:
- On first login, seed 7 default widgets per user (mirroring today's hardcoded set) so the dashboard isn't empty. This is a one-shot fixture run on user creation — handle in `users` service.

**AI-suggest prompt template**:
```
You convert a user request into a widget configuration JSON for the {widget_type} widget. The JSON MUST validate against this schema: {schema}. Available data sources: {data_sources}. User request: {prompt}. Reply with the JSON only, no prose.
```
Strict JSON-mode call (Gemini Flash structured output). Reject on schema validation failure; do not retry silently — surface the error to the user with a "try rephrasing" hint.

**Quota**:
- AI-suggest counts as one AI call against `users.requests_used`.
- Widget data renders are free (just server-side aggregation).

**Out of scope (Phase 3)**:
- HTML/CSS/JS custom widgets (revisit only if a power user explicitly asks).
- Sharing layouts across users / orgs.
- Widget marketplace / community catalog.
- Per-widget refresh intervals (everything is on-demand for v1).

**Effort**: L (one backend agent + one frontend agent, ~1.5 sprints).

### Track F — Saved Companies lists

**Goal**: BD lead saves a working list of 50 prospects they're chasing this quarter. The list shows up in the sidebar, exports to CSV, becomes the audience for alerts/digests.

**Backend**:
- New table `saved_lists(id, user_id, name, created_at)` + `saved_list_items(list_id, company_id, added_at, note)`.
- CRUD endpoints `/api/v1/lists` and `/api/v1/lists/{id}/items`.

**Frontend**:
- Sidebar entry under existing nav.
- In Directory: "Add to list" action on row + bulk action on selection.
- Drawer view of a list with notes column + remove button.

**Effort**: S–M.

---

## 6. What we're deferring (with reason)

| Item | Reason | Re-open when |
|------|--------|--------------|
| Custom Widget Builder (HTML/CSS/JS panels with AI assist) | Big surface, low BD-lead value | After Tracks A–D prove pull and we have ≥ 5 paying Pro users asking for it |
| Native desktop app (Tauri) | Web is fine | We see ≥ 100 weekly users and >20% open the site >5×/day |
| 3D globe / dual map | KZ-only doesn't need 3D | Never. Re-open if we expand to a multi-region product. |
| Local Ollama option | Conflicts with our AI Gateway design (ADR-0001) | Only if a customer explicitly demands on-prem AI |
| "65+ data sources" race | Quality over count | Per `07-product-redesign.md` §6 |
| Geopolitical frameworks | Off-persona | Never, for the BD persona |

---

## 7. Concrete next 6 PRs (after the current Phase 2 frontend tracks land)

Execution order is meaningful: lighter / unblocking tracks first.

| # | Title | Owner | Track | Complexity |
|---|-------|-------|-------|------------|
| 1 | `saved_lists` table + CRUD + sidebar UI | backend + frontend | F | S |
| 2 | Multi-channel alert delivery (Slack/Discord/Webhook + HMAC + quiet hours) | backend | C | M |
| 3 | MK MCP server (standalone package, 5 tools, stdio) | backend / devops | D | S |
| 4 | MK Analyst chat — drawer + `/api/v1/analyst/query` (no streaming for v1) | backend + frontend + ai | A | M |
| 5 | Region Risk Index — MV + endpoint + map metric | backend + frontend | E | M |
| 6 | AI Digest jobs — schedule + ranker + Slack/Email delivery | backend + ai | B | M |

Each PR should reference this document and pin the spec sub-section it implements.

---

## 8. Clean-room enforcement (process)

1. **No agent in this workstream reads `koala73/worldmonitor` source.** If an agent asks "should I check how they did X?", the answer is no — file a question against this doc instead, we'll resolve it from first principles or our own codebase.
2. **No copy of file/module names** from WM ("WM Analyst" → our name is **MK Analyst**, not a transliteration; their `digest-job.ts` → our `app/services/digest.py` with our own structure).
3. **Commit messages** for clean-room tracks must say `clean-room: track X` so reviewers know which guard rails apply.
4. **PR description** template: "Spec section: `docs/aistart360/08-world-monitor-feature-parity.md` §5.X". No links to WM source files in PRs.
5. If anyone *does* read WM source by accident, declare it on the PR and back the affected change out — we lose the clean-room status for that surface and have to redo it.

---

*End of document. Next action: founder confirms which of the 6 tracks ship in the next sprint, then we dispatch implementation agents on the picked subset.*
