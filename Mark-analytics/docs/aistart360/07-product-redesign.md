# 07 — Product Redesign: Sharp Critique + 90-Day Blueprint

> Written 2026-05-26 by `system-architect` for the founder. Pairs with `docs/aistart360/00-product-vision.md` and `docs/11-roadmap.md`. Scope: cut the 12-module brief down to what we can actually ship, then ship it.

---

## 1. TL;DR

- The **scaffold is solid** (FastAPI + Postgres + pgvector + Arq + AI Gateway), the **product is hollow**: 1 spider that 401s, zero real ingest, KPIs that read `0` because the table is empty.
- The dev dashboard at `/` (`backend/app/web/templates/dashboard.html`) is a good debugging tool but is **being mistaken for a product**. It mixes filters, raw JSON, and analytics — confusing for a buyer, fine for us.
- We are trying to be Bloomberg × Crunchbase × Statista on month 1. **Pick one persona, ship one wedge.** I argue for **Sales/BD leads at B2B companies selling into KZ** — see §3.
- This month, do exactly three things: (a) land 3 real data sources, (b) ship a credible Company Profile page, (c) put freshness/provenance badges on every card. Everything else can wait.
- Phase-2 hype (graph view, federated uploads, predictive scoring) gets **deferred without apology**. Re-open only when we have 100K real companies and a paying user asking for it.

---

## 2. Executive critique of current state

**UX/UI density.** The dashboard at `backend/app/web/templates/dashboard.html` is a single-page wall: header + 300px filter sidebar + KPI grid + tabs + JSON panel. Two real problems: (1) KPIs render `0` because `backend/app/services/analytics.py::overview` runs against an empty `companies` table — the user sees "Total companies: 0" and bounces; (2) the filter sidebar is permanently mounted, so the analytics view never gets full width. Fix: split into a presentation app (read-only, full-bleed charts, no filter sidebar by default) and an operator console (this dashboard, gated behind a flag).

**Information architecture.** Today everything sits under `/` with tab toggles. Filters, companies list, forecasts, raw API output, and analytics are siblings. This conflates three jobs (browse, analyse, debug) under one chrome. The user can't form a mental model of "where am I". Fix: explicit modules with their own routes — see §4.

**Data layer maturity.** Models exist (`Company`, `Page`, `AiCallLog`, `Forecast`), migrations are clean, pgvector is up. But the only spider is `kz_goszakup` which we already know returns 401 on the real API. There is no `companies_changes` (CDC) table populated, no `field_provenance`, no `data_freshness_at` column the UI can show. We have a database schema and no data — the most common failure mode for OSINT products.

**Analytics depth.** `analytics.py` ships overview + 5 distributions + rule-based insights. That is genuinely useful and it's the strongest module right now. What's missing: **time-series of anything**. No "new companies per month", no "tender volume per quarter", no "industry share over time". That requires CDC + historical snapshots, which requires real ingest first. Until then, analytics is a static snapshot. Be honest with the user about it.

**AI integration.** AI Gateway routing logic works (`app/ai/` is well-factored, OpenRouter + Google providers wired). But: no API keys configured by default, so on a fresh Railway deploy every AI call short-circuits to "AI disabled". The `generate_insights()` function in `analytics.py` is **rule-based** — there is no AI in the AI insights card. That's fine for now, but the UX should label it as such ("Heuristic insights — upgrade Pro for AI explanation") instead of pretending.

**Trust signals.** None visible. The user has no idea whether a record came from goszakup yesterday or was scraped from a 2018 Excel file. No `updated_at` shown, no source pill, no confidence score. This is the #1 reason buyers reject OSINT products — they can't tell what to trust. Fix in §8.

---

## 3. Product positioning re-statement

**Primary persona for the next 6 months: Sales/BD lead at a B2B vendor selling into Kazakhstan.**

Why this one, not founder/investor/consultant:

- **Highest budget velocity.** A BD lead at a SaaS or services company will pay $99–$299/mo on a corporate card without a procurement cycle. Investors negotiate, founders are price-sensitive, consultants want white-label (a Phase-3 problem).
- **Clearest "job" we can serve today.** "Give me a filtered list of KZ companies that match my ICP, with director name + contact hints, exportable to CSV." That's a list + filters + export. We can ship that in 4 weeks with our current schema.
- **Tolerant of incomplete data.** A BD lead doesn't need 100% coverage — 60% of relevant companies with a phone number is already better than what Kompra gives them. Investors and consultants demand completeness.
- **Drives the right roadmap.** Optimising for BD forces us to fix data quality and freshness — exactly what every other persona will eventually need. Optimising for investors first would push us toward graph/scoring, which is fancier and far less valuable on month 1.

The other personas don't go away — they get **disabled UI** with a "coming soon" tag. Investor module = graph view + risk overlay, deferred to month 4. Consultant module = report builder, deferred to month 6. Founder module = the existing AIStart360 diagnostics flow, already shipped elsewhere.

---

## 4. Information architecture redesign

Five top-level modules. Everything else collapses into these. The dev dashboard becomes a hidden `/admin` page.

```
/                     → Overview (lands here)
/companies            → Advanced Directory
/companies/{id}       → Company Profile (drawer or full page)
/forecasts            → Forecasts
/filters              → Filter Studio (saved searches, alerts)
/api                  → Developer Console (docs, keys, sample requests)
/admin                → existing dev dashboard, internal only
```

### Module: Overview
- **Purpose.** First impression. Show the BD lead "the KZ market in 6 widgets" and prove the data is alive.
- **Key screens.** (1) Hero with 4 KPIs + freshness badge. (2) Industry treemap (clickable → directory). (3) Recent signals feed (new registrations, large tenders won, executive changes).
- **Primary action.** Click a segment → land in `/companies?industry=...` pre-filtered.

### Module: Advanced Directory
- **Purpose.** The core list. This is the BD lead's daily driver.
- **Key screens.** (1) Filter rail (left, collapsible) + results table (right). (2) Saved-search bar at top. (3) Bulk-select → Export CSV / Add to alert.
- **Primary action.** Filter → export. Everything else is secondary.

### Module: Company Profile
- **Purpose.** "Tell me everything you know about this company, with sources."
- **Key screens.** (1) Header (name, BIN, industry, status, freshness, source pills). (2) Tabs: Overview / People / Tenders / News / Changes / AI Summary. (3) "Similar companies" rail at the bottom.
- **Primary action.** Copy a contact, add to a saved list, or trigger an alert on this entity.

### Module: Forecasts
- **Purpose.** Convert market data into a single decision-relevant number (TAM, CAC/LTV, niche score).
- **Key screens.** (1) Forecast picker (4–6 calculators). (2) Input form with sliders. (3) Result panel with confidence band + AI caption.
- **Primary action.** Save the forecast as PDF/share link.

### Module: Filter Studio
- **Purpose.** Power-user surface for saved searches + alerts.
- **Key screens.** (1) Filter builder (taxonomy from `app/filters/registry.py`). (2) Preview pane (live count). (3) "Convert to alert" CTA.
- **Primary action.** Save filter → enable email/Telegram alert.

The current `/` dashboard collapses into `/admin`. The presentation `/` becomes Overview. Filter sidebar moves into the Directory module only.

---

## 5. Smart analytics priorities (next 90 days)

### Tier 1 — must have (ship in weeks 1–6)
| Item | Why |
|------|-----|
| Industry treemap on Overview | Best one-glance density chart for "what's the KZ market made of"; data already shaped by `industry_distribution()`. |
| Country comparison bar | We're "KZ + CIS"; users want to see Kazakhstan vs neighbours. Trivial off `country_distribution()`. |
| Growth leaders table | Already wired (`growth_leaders()`); rename column from "growth" to "revenue rank" until we have CDC — see §2. |
| AI insights card (labelled "heuristic" until real AI) | `generate_insights()` is good. Just label honestly. |
| Company drawer | Click a row in Directory → side drawer with profile. Doubles perceived data density without a full page reload. |

### Tier 2 — should have (weeks 7–12, requires real ingest first)
| Item | Why |
|------|-----|
| Time-series (new companies / month, tender volume / quarter) | Requires `companies_changes` CDC table populated by ingest. Useless if we ingest once. |
| Procurement signal (tender wins by company → growth proxy) | Goszakup has the data; we need to actually land it. |
| Similarity recommendation ("companies like this") | We have pgvector + embeddings infra. Just needs embedded rows. Cheap, high perceived value. |

### Tier 3 — defer (Q3+, do not start)
| Item | Why deferred |
|------|--------------|
| Graph view (Neo4j) | High infra cost, low Tier-1 persona value. Re-open when an investor customer asks. |
| Predictive scoring (Investment Thesis AI) | Marketing line, not a real need yet. Premium-tier feature, no premium users yet. |
| Federated upload analytics | Requires moderation pipeline + critical mass of opted-in datasets. Both are zero today. |

---

## 6. Data ingestion realistic plan

Honest baseline: we have `kz_goszakup.py` and it 401s against the real endpoint. Pretending otherwise wastes the founder's time. Here are 3 sources that can land in 4 weeks **with public access today**.

### Source 1 — Statistics Committee of KZ open data (stat.gov.kz)
- **Why.** Official, free, no auth. Publishes the BIN registry and industry breakdowns in CSV/XLSX. Authoritative baseline for "what companies exist".
- **Parser approach.** Scheduled HTTP download → pandas → `Company` upsert by `bin`. Pure pipeline, no scraping, no anti-bot. New spider class: `app/crawlers/spiders/kz_stat.py` (downloader, not Scrapy spider).
- **Expected count.** ~400K active legal entities in KZ. Realistic to land 200K in week 1.

### Source 2 — Goszakup HTML mirror (not the broken API)
- **Why.** Same data the 401-ed API exposes — tenders + winners + customers — but reachable as plain HTML on `goszakup.gov.kz/ru/search/announce` with pagination. Avoids the auth wall.
- **Parser approach.** Scrapy spider with rotating user-agent + 1 req/sec throttle. Parse listing → tender detail. Persist as `Tender` + link to `Company` by BIN (which is on every page).
- **Expected count.** ~50K tenders/year published. Backfill 2 years = 100K. Reasonable in 2 weeks.

### Source 3 — egov.kz "Business Information" portal (jusan / open APIs)
- **Why.** Public lookup-by-BIN endpoint returning legal form, status, registration date, director name. Used by every KZ fintech for KYC. No auth for read.
- **Parser approach.** Reactive enrichment: when a `Company` row exists with `bin` but no `director_name`, enqueue an Arq task → call egov endpoint → patch the row. Pull-style, demand-driven, no bulk scrape.
- **Expected count.** ~150K enriched within 4 weeks, capped by rate-limit budget.

**Sources we explicitly do not chase yet:** 2GIS (Playwright + anti-bot, high cost), Kompra (paid, legal risk), Telegram channels (low signal/effort ratio for BD persona), Russian EGRUL (geopolitical/legal risk for a CIS-first product).

---

## 7. Hybrid API + parsing matrix

| Source | Access method | Confidence | Freshness target | Owner |
|--------|---------------|------------|------------------|-------|
| stat.gov.kz BIN registry | Bulk CSV download | High (official) | Weekly | `crawl-engineer` |
| goszakup.gov.kz tenders | HTML scraping | High (gov source) | Daily | `crawl-engineer` |
| egov.kz BIN lookup | Pull API on demand | High | On-access (cache 30d) | `crawl-engineer` + `backend-engineer` |
| User uploads (CSV/XLSX) | Multipart upload + LLM mapping | Medium (user-asserted) | Per upload | `backend-engineer` |
| News (forbes.kz, kursiv.kz, rbc.kz) | RSS + HTML | Medium | Daily | `crawl-engineer` (Phase 2) |
| 2GIS | Playwright + proxy | Medium-low | Monthly | `crawl-engineer` (Phase 2) |
| Court cases (court.gov.kz) | HTML scraping | High but partial | Weekly | `osint-engineer` (Phase 3) |
| Sanctions (OFAC, EU, UN) | Daily JSON pull | High | Daily | `osint-engineer` (Phase 3) |

Confidence column maps directly to the source pill colour in §8.

---

## 8. Data quality + trust signals (4 visible signals)

| Signal | Where | How computed | When shown |
|--------|-------|--------------|------------|
| **Source confidence** | Pill next to every field on Company Profile + chip on directory rows | Static map from source → confidence band (High/Medium/Low) per §7 matrix | Always |
| **Data freshness** | Header of every entity card: "as of 3 days ago" | `max(field_provenance.extracted_at)` per entity; format as relative time, red if > 90 days | Always |
| **Completeness %** | Progress bar on Company Profile header | Count of non-null fields in a defined "core schema" (name, bin, industry, status, address, director, phone, website) ÷ 8 | Always |
| **Change history** | Tab on Company Profile + small "Δ" badge on directory rows when changes exist in last 30d | Query `companies_changes` (CDC table — must be implemented) | On profile; badge only when changes ≥ 1 |

Add a single backend field `data_quality` to the `/companies/{id}` envelope so the frontend doesn't have to compute it:

```jsonc
{
  "data_quality": {
    "confidence": "high",
    "freshness_at": "2026-05-23T...",
    "completeness_pct": 75,
    "recent_changes": 3
  }
}
```

Until CDC is live, `recent_changes` returns `null` (not `0`) — frontend then hides the badge instead of lying.

---

## 9. AI use cases prioritized

### Cheap, every request (Gemini Flash 8B via Google AI Studio)
- Industry classification (NACE/OKED label inference from free text)
- Deduplication scoring (pairwise similarity for ER candidates)
- Name normalisation (legal-form stripping, casing, transliteration)

### Medium, on-demand (Gemini Flash)
- Field extraction from HTML/PDF pages
- Company summarisation (2–3 paragraphs)
- Filter NL→structured translation ("saas в Алматы с выручкой >1M" → JSON filter)

### Premium, paid tier only (Gemini Pro / Claude Sonnet)
- Investment Thesis generation
- Procurement-signal interpretation (multi-tender narrative)
- Custom report drafting (Consultant tier, Phase 3)

### Per-user-per-month cost ceilings

| Tier | Cheap pool | Medium pool | Premium pool | Hard cap |
|------|-----------|-------------|--------------|----------|
| Free | $0.10 | $0 | $0 | $0.10 |
| Starter | $0.50 | $0.30 | $0 | $0.80 |
| Pro | $1.00 | $1.20 | $0.30 | $2.50 |
| Business | $3.00 | $4.00 | $1.50 | $8.50 |

Enforced at the AI Gateway (`requests_used` / `cost_used` on `users`). When a user is within 80% of cap, surface a toast in the UI ("AI quota 80% used this month"). At 100% we return a structured error, not a 500. This keeps us inside the "AI cost / paying user / mo < $1.50" target in `00-product-vision.md`.

---

## 10. MVP scope cut (ship in 4 weeks)

### Ship
- Overview module with 4 KPIs + treemap + country bar + AI insight card (heuristic)
- Advanced Directory with filter rail + table + CSV export + saved searches (server-side)
- Company drawer (slide-in from Directory) with header + Overview tab + Changes tab (empty-state OK)
- Data ingest: stat.gov.kz registry + goszakup HTML mirror → 200K real companies, 50K real tenders
- Trust signals: confidence pill + freshness timestamp on every card
- Quota gating at AI Gateway with toast in UI

### Defer (loudly)
- Graph view
- Neo4j
- Federated upload analytics
- Investment Thesis AI
- Report builder
- White-label
- Mobile app
- Time-series charts (until 4 weeks of CDC data exist)
- Russian EGRUL ingestion
- 2GIS Playwright crawler
- Persons module + role history
- Drag-and-drop dashboard layout (`user_dashboard_layouts` table)

The hard rule: if it isn't in the "Ship" list, it doesn't get a half-built UI placeholder. We either show a polished module or no module. Half-built placeholders kill trust faster than missing features.

---

## 11. Concrete next 10 PRs (execution order)

| # | Title | Owner | Complexity |
|---|-------|-------|------------|
| 1 | Migrate `companies_changes` CDC table + trigger on `companies` UPDATE | `backend-engineer` | S |
| 2 | Add `data_freshness_at` + `confidence` columns to `companies`; backfill default | `backend-engineer` | S |
| 3 | New spider: `kz_stat` downloader for BIN registry (CSV → upsert) | `crawl-engineer` | M |
| 4 | Rewrite `kz_goszakup` spider to scrape HTML mirror (drop broken API) | `crawl-engineer` | M |
| 5 | `GET /api/v1/companies/{id}` returns `data_quality` envelope | `backend-engineer` | S |
| 6 | New Overview page (presentation `/`) with treemap + KPI cards + AI insight | `frontend-engineer` | M |
| 7 | Directory page: filter rail + table + CSV export + company drawer | `frontend-engineer` | L |
| 8 | egov.kz on-demand enrichment Arq task | `backend-engineer` + `crawl-engineer` | M |
| 9 | AI Gateway quota enforcement + UI toast contract | `ai-engineer` + `backend-engineer` | M |
| 10 | Move existing `/` dashboard to `/admin` behind feature flag | `backend-engineer` | S |

Execution order is non-negotiable: 1–2 unblock everything else; 3–4 fill the database so 5–7 have something to render; 8–9 round out quality; 10 cleans up the surface.

---

## 12. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Supabase free tier (500 MB) blows up once we land 200K companies | High | Medium | Pre-emptively upgrade to Pro ($25/mo) before PR #3 merges; move R2-eligible raw HTML out of Postgres |
| Goszakup blocks our HTML mirror IP | Medium | High | Use residential proxy from week 1; throttle at 1 req/sec; cache aggressively; treat 429/403 as backoff signal |
| AI cost runaway (one user burns $50 in a day) | Medium | Medium | Hard caps in §9 enforced server-side, not just UI; daily $/user alert in Grafana |
| Frontend integration friction with AIStart360 portal repo (we don't own it) | High | High | Freeze API contract at PR #5; ship OpenAPI client autogen; weekly cross-team sync; ship our own minimal `/` as fallback so we're never blocked |
| Stat.gov.kz changes CSV schema without notice | Medium | Medium | Schema validation step in `kz_stat` spider; on mismatch, raise + alert, don't write |
| Founder pivots scope mid-sprint ("can we add graph view next week") | High | High | This document. Point at §5/§10. Make the cost of pivot visible: "yes, but it drops PR #7 by 2 weeks." |

---

## 13. ADRs needed next sprint

1. **ADR-0007: Trust signals contract** — codify the `data_quality` envelope from §8 so frontend and backend agree on shape and semantics before either ships.
2. **ADR-0008: Ingest strategy — pull over scrape where possible** — record the §6 ranking (official APIs > HTML mirrors > anti-bot scraping) and the legal/operational reasons.
3. **ADR-0009: AI quota enforcement at the gateway** — locks in the §9 cost ceilings, the toast contract, and the per-tier hard caps. Supersedes the loose quota mention in `00-product-vision.md` §3.
4. **ADR-0010: Persona-first roadmap (BD lead before investor/consultant)** — formalises §3 so it doesn't get re-litigated every sprint. Lists the exact conditions under which we add the next persona.
5. **ADR-0011: CDC table for `companies_changes`** — schema, trigger strategy (DB trigger vs application-level), retention, and the read pattern for `/companies/{id}/changes`.

Author each as a 5-section ADR (Context · Decision · Consequences · When to revisit · Alternatives), file under `docs/adr/`.

---

*End of document. Next action: founder reviews §3 (persona) and §10 (scope cut). Everything else flows from those two decisions.*
