# AIStart360 — Market Intelligence Module

> The backend in this repo is the **Market Intelligence mega-section** of the AIStart360.app platform. AIStart360.app is the existing Next.js portal on Vercel; this backend powers its premium subscription tier focused on Kazakhstan & CIS business analytics.

## 1. Product vision

A hybrid of Bloomberg Terminal × Crunchbase × Statista × McKinsey dashboards × OSINT intelligence — adapted for SMBs, startups, investors, consultants and agencies in Kazakhstan and CIS markets, with a UX that **removes complexity rather than displays it**.

### Jobs-to-be-done

| Persona | Job | Killer feature |
|---------|-----|----------------|
| Founder / SMB owner | "Where should I expand?" | Niche scoring + TAM/SAM/SOM + competition pressure index |
| Investor (VC / angel) | "Is this market interesting? Is this company healthy?" | Investment Thesis AI + company graph + risk overlay |
| Consultant / Agency | "Build a client report in 1 hour, not 1 week" | Report Builder + data export + white-label dashboards |
| Sales / BD lead | "Find lookalikes of my best customers" | Semantic similar-companies + alerting on signals |
| Researcher / Journalist | "Connect the dots between companies, people, money" | Graph navigation + OSINT entity linking |

### Why now / Why us

- Crunchbase/Apollo/PitchBook are USA-centric, weak/expensive for CIS.
- Existing CIS solutions (Kompra, Adata, СПАРК) are siloed catalogs — no AI, no forecasting, no graph.
- LLMs commodified extraction & enrichment; cost of running this dropped 100× in 2 years.
- AIStart360.app already has paying users, distribution, brand → faster GTM than greenfield.

## 2. Where this module lives

```
AIStart360.app                                        This repo (backend)
─────────────────                                     ────────────────
Vercel · Next.js 14 (App Router) · Supabase           Railway/Fly · FastAPI · Supabase Postgres
├── /diagnostics (existing)                           ├── /api/v1/companies, /tenders, /persons
├── /coaching (existing)                              ├── /api/v1/search, /trends, /alerts
├── /toolkit (existing)                               ├── /api/v1/forecasting/{tam,cac_ltv,...}
└── /market-intelligence  ◄── THIS MODULE             ├── /api/v1/uploads (user data ingestion)
    ├── /dashboard                                    ├── /api/v1/billing/* (tier checks, quotas)
    ├── /companies/[id]                               └── /api/v1/internal/* (webhooks)
    ├── /search
    ├── /forecasts/[type]                             AI Gateway → OpenRouter + Google AI Studio
    ├── /reports                                      Workers (Arq) → crawl, enrich, alert
    └── /uploads
```

The frontend module is implemented in the **AIStart360.app repo** (separate from this one). This repo exposes the REST API + workers that the module consumes.

## 3. Tier & subscription model

| Tier | Price/mo | Quotas | Surface |
|------|----------|--------|---------|
| **Free / Trial** | 0 | 50 searches, 5 company profiles/mo, 0 forecasts, 0 uploads | Browse only |
| **Starter** | ~$29 | 1k searches, 50 profiles, 3 alerts, 5 forecasts/mo | Dashboard + basic search |
| **Pro** | ~$99 | 10k searches, 500 profiles, 25 alerts, unlimited forecasts | + graph view, summaries, exports |
| **Business** | ~$299 | 100k searches, unlimited profiles, 100 alerts, advanced AI | + custom uploads, report builder, API |
| **Enterprise** | custom | unlimited | + SSO, white-label, dedicated SLAs, data feeds |

Quotas enforced at the AI Gateway (`requests_used`/`requests_limit` on `users`) and at the API rate-limit layer.

## 4. Non-goals (anti-scope, MVP)

- ❌ Custom dashboards designer (Phase 3).
- ❌ Mobile apps (Phase 4+).
- ❌ Replace existing AIStart360 diagnostics/coaching — we **integrate**, not duplicate.
- ❌ Build our own LLMs.
- ❌ Sell raw data dumps — value is in interactive analytics + insight, not the rows themselves.

## 5. Success metrics

| Metric | MVP (M1–M3) | Phase 2 (M4–M6) | GA (M12) |
|--------|-------------|------------------|----------|
| Companies indexed (KZ) | 500K | 1M | 2M |
| Companies indexed (CIS) | 1M | 5M | 10M |
| MAU of Market Intelligence module | — | 200 | 2000 |
| Paying conversion | — | 5% | 12% |
| AI cost / paying user / mo | < $1.50 | < $0.80 | < $0.50 |
| Median freshness | 30 d | 14 d | 7 d |
| NPS | — | > 30 | > 50 |

## 6. Integration touchpoints with AIStart360.app

- **Single sign-on**: same Supabase Auth instance (no separate login).
- **Single billing**: tier comes from the user's AIStart360 subscription (one bill, multiple modules).
- **Cross-link**: from a Diagnostics report ("your industry is X"), one-click into Market Intelligence ("see all X-industry companies in your region").
- **Data write-back**: when a user pins a company or saves a forecast — visible in their AIStart360 workspace.
- **AI copilot continuity**: the same AI copilot threads can pull data from Market Intelligence on demand.

See `docs/aistart360/05-integration-with-platform.md` for the contract.

## 7. Roadmap link

Phase plan: see [`docs/11-roadmap.md`](../11-roadmap.md). Phase 1 (MVP M1–M3) maps to this module's launch as "Beta — Pro tier only". Phase 2 expands tiers, adds Forecasting Engine and Uploads. Phase 3 adds Enterprise features.
