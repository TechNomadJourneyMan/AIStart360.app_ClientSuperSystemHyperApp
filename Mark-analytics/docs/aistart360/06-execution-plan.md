# AIStart360 — Claude Code Multi-Agent Execution Plan

> This document maps the 19 deliverables from the project brief to specific Claude Code sub-agents, files, and milestones. Use as the operating playbook for sprint planning.

## 1. Deliverables → docs/files mapping

| # | Deliverable | Lives in | Status |
|---|-------------|----------|--------|
| 1 | Product Vision | `docs/aistart360/00-product-vision.md` | ✅ done |
| 2 | System Architecture | `docs/01-architecture.md` | ✅ done |
| 3 | Database Architecture | `docs/05-data-model.md` | ✅ done |
| 4 | AI Agent Architecture | `docs/04-agents.md` + `docs/02-ai-gateway.md` | ✅ done |
| 5 | Data Pipeline Architecture | `docs/07-crawling.md` + `docs/06-osint-pipeline.md` | ✅ done |
| 6 | Frontend Architecture | (separate frontend repo + `docs/aistart360/02-visualizations.md`) | partial |
| 7 | Visualization Strategy | `docs/aistart360/02-visualizations.md` | ✅ done |
| 8 | Forecasting Engine Design | `docs/aistart360/03-forecasting-engine.md` | ✅ done |
| 9 | Security Architecture | `docs/09-deployment.md` (sec section) + ADRs | partial — TODO `docs/aistart360/07-security.md` |
| 10 | Claude Code Implementation Plan | this file | ✅ done |
| 11 | API Strategy | `docs/10-api-contract.md` | ✅ done |
| 12 | DevOps & Deployment | `docs/09-deployment.md` | ✅ done |
| 13 | Testing Strategy | TODO `docs/aistart360/08-testing.md` | pending |
| 14 | Recommended Tech Stack | `docs/01-architecture.md` (stack section) + ADRs | ✅ done |
| 15 | Multi-Tenant SaaS Design | TODO `docs/aistart360/09-multi-tenant.md` | pending (Phase 4) |
| 16 | AI Provider Strategy | `docs/02-ai-gateway.md` + `docs/03-model-catalog.md` | ✅ done |
| 17 | Filter Taxonomy | `docs/aistart360/01-filter-taxonomy.md` | ✅ done |
| 18 | Uploads & Moderation | `docs/aistart360/04-uploads-and-moderation.md` | ✅ done |
| 19 | Platform Integration | `docs/aistart360/05-integration-with-platform.md` | ✅ done |

## 2. Sub-agent tracks (8 specialized agents)

| Agent | Owned subtree | Sprint-level outputs |
|-------|---------------|----------------------|
| `system-architect` | `docs/`, `docs/adr/` | ADRs, design reviews, scope changes |
| `backend-engineer` | `app/api/`, `app/models/`, `app/schemas/`, `app/db/`, `app/core/`, `app/services/`, `app/billing/`, `app/filters/`, `app/forecasting/` | endpoints, models, migrations, services |
| `crawl-engineer` | `app/crawlers/`, crawl-related workers | spiders, anti-bot, refresh policies |
| `ai-engineer` | `app/ai/`, `app/agents/extraction.py`, `classification.py`, `summarization.py`, prompts, AI tests | gateway impls, routing changes, prompt versions |
| `osint-engineer` | `app/osint/`, `app/agents/discovery.py`, Neo4j integration | entity resolution, graph queries, sanctions |
| `devops-engineer` | `infra/`, `.github/`, `scripts/` | deploy, CI, secrets, scaling |
| `security-engineer` | `app/core/security.py`, RLS migrations, audit | auth, RLS, vuln triage, audit |
| `frontend-engineer` | separate AIStart360 frontend repo | UI for market intel module |

Sub-agent configs live in `.claude/agents/*.md`.

## 3. Milestone-driven sprint plan (6 sprints × 2 weeks)

### Sprint 1 (M1, weeks 1–2) — Foundation
**Goal**: API up, auth working, one source ingested end-to-end.

| Task | Owner | Files |
|------|-------|-------|
| Backend scaffold + Supabase JWT auth | backend-engineer | `app/core/`, `app/main.py` ✅ |
| AI Gateway core (OpenRouter + Google providers) | ai-engineer | `app/ai/*` |
| Postgres schema + migration 0001 | backend-engineer | `app/db/migrations/`, `app/models/` |
| First spider: `kz_goszakup` | crawl-engineer | `app/crawlers/spiders/kz_goszakup.py` |
| Arq worker boot | crawl-engineer | `app/workers/main.py` |
| Deploy to Railway, healthcheck green | devops-engineer | `infra/railway/`, `.github/workflows/` ✅ |
| `GET /companies` (empty stub OK), `/health` ✅ | backend-engineer | `app/api/v1/` |

**Deliverable demo**: hit `/api/v1/companies?country=KZ` and get 100 real tenders' issuers.

### Sprint 2 (M1, weeks 3–4) — Companies pipeline
**Goal**: 100K KZ companies in DB; semantic search; deduped.

| Task | Owner | Files |
|------|-------|-------|
| Spider: `kz_kompra` | crawl-engineer | `app/crawlers/spiders/kz_kompra.py` |
| ExtractionAgent (LLM-based) | ai-engineer | `app/agents/extraction.py` |
| Entity resolution v1 | osint-engineer | `app/osint/dedup.py` |
| Embeddings via fastembed | ai-engineer | `app/ai/providers/local_embed.py` |
| `POST /search` hybrid | backend-engineer | `app/api/v1/search.py` |
| Filter registry MVP | backend-engineer | `app/filters/registry.py` |
| Frontend integration: list + detail page | frontend-engineer | (separate repo) |

**Deliverable demo**: search "saas компании в Алматы" returns ranked results with semantic + filter match.

### Sprint 3 (M2, weeks 5–6) — Alerts + Trends + Tier gating
**Goal**: Pro tier users get alerts; basic trend dashboards live.

| Task | Owner | Files |
|------|-------|-------|
| AlertRule CRUD + AlertAgent | backend-engineer + ai-engineer | `app/api/v1/alerts.py`, `app/agents/alert.py` |
| Telegram + Email delivery | backend-engineer | `app/notifications/` |
| Trends materialized views | backend-engineer | migration + `app/services/trends.py` |
| `GET /trends/*` endpoints | backend-engineer | `app/api/v1/trends.py` |
| Tier gating middleware | backend-engineer + security-engineer | `app/billing/tier.py`, `app/core/deps.py` |
| Cost monitoring dashboard | devops-engineer | `scripts/cost_report.py` + Grafana |
| Spider: `kz_2gis` (Playwright) | crawl-engineer | `app/crawlers/spiders/kz_2gis.py` |

### Sprint 4 (M3, weeks 7–8) — Forecasting MVP + Uploads
**Goal**: TAM/SAM/SOM, CAC/LTV, basic uploads.

| Task | Owner | Files |
|------|-------|-------|
| `Forecast` base + 4 calculators | backend-engineer + ai-engineer | `app/forecasting/`, `app/api/v1/forecasts.py` |
| `forecasts` table + migration | backend-engineer | migration |
| Uploads endpoint + R2 sandbox | backend-engineer | `app/api/v1/uploads.py`, `app/uploads/` |
| Schema inference for CSV/XLSX | ai-engineer | `app/uploads/inference.py` |
| Frontend forecast UI | frontend-engineer | (separate repo) |

### Sprint 5 (M4, weeks 9–10) — Graph + OSINT
**Goal**: Neo4j sync; relationship visualization.

| Task | Owner | Files |
|------|-------|-------|
| Neo4j AuraDB schema + sync | osint-engineer | `app/osint/graph/` |
| `GET /companies/{id}/graph` | backend-engineer | endpoint |
| OSINT entity linking (news → companies) | osint-engineer | `app/agents/discovery.py` extensions |
| Sanctions sync script | osint-engineer | `scripts/sync_sanctions.py` |
| Spider: 3 news sources | crawl-engineer | `app/crawlers/spiders/news_*.py` |

### Sprint 6 (M5, weeks 11–12) — Enrichment depth + polishing
**Goal**: Vision OCR; summary endpoint; performance pass; first paying user.

| Task | Owner | Files |
|------|-------|-------|
| Vision OCR for PDF docs | ai-engineer | extend extraction agent |
| Spider: court / litigation data | crawl-engineer | new spider |
| SummarizationAgent + `/companies/{id}/summary` | ai-engineer + backend-engineer | agent + endpoint |
| Semantic cache rollout (measured) | ai-engineer | `app/ai/cache.py` |
| Perf pass: API p95 < 400ms | backend-engineer | indexes, query review |
| Subscription/billing wiring with AIStart360 webhook | backend-engineer + devops-engineer | `app/billing/`, webhook endpoint |

## 4. Dependencies graph

```
Foundation ─┬─► Companies pipeline ─┬─► Alerts/Trends ─┬─► Forecasting ─┬─► Graph/OSINT ─► Polish
            │                       │                  │                │
            │                       │                  │                ▼
            │                       ▼                  ▼          Vision/Summary
            │                Filter registry      Tier gating
            ▼                       │                  │
       Spider 1 (goszakup)          │                  ▼
                                    │             Uploads MVP
                                    ▼
                              Spider 2,3 (kompra, 2gis)
```

## 5. Cross-cutting workstreams (continuous)

- **Observability**: structured logs from day 1; Sentry + OTel from sprint 2; cost dashboard from sprint 3.
- **Security**: Supabase JWT + RLS from sprint 1; audit log from sprint 3; pen-test before sprint 6 demo.
- **Documentation**: every PR updates relevant doc; ADR for every non-trivial decision.
- **Testing**: unit tests required for every new module; integration tests by sprint 3; load test by sprint 5.

## 6. Definition of done (per ticket)

- [ ] Code compiles, ruff + mypy pass
- [ ] Unit tests added (covering happy + 1 edge)
- [ ] Doc updated if behavior changed
- [ ] Telemetry added (logs + at least one metric)
- [ ] If endpoint: response envelope used + OpenAPI summary written
- [ ] If AI call: routed through gateway, prompt versioned
- [ ] If migration: tested on docker postgres + reviewed
- [ ] PR description references the sprint task

## 7. Risk register (top 5)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Crawl blocked en masse (2GIS, gov) | Med | High | residential proxies + rotation; rate-limit conservative |
| AI cost runaway | Med | Med | daily ceiling alert + cache hit-rate SLO |
| Supabase free tier hit (500MB) | High | Med | early eject to Pro $25; cold data → R2 |
| Frontend integration friction | Med | High | API freeze early; contract tests; OpenAPI client autogen |
| Hallucinated extractions | High | Med | rule-based first; LLM with structured output; validation step |

## 8. What's parallelizable RIGHT NOW

- ai-engineer: AI Gateway implementation (no blockers)
- backend-engineer: data layer + initial schemas (no blockers)
- crawl-engineer: kz_goszakup spider (depends on `Page` model — coordinate import contract)
- devops-engineer: nothing new (infra is in place)
- security-engineer: write RLS policies (depends on data layer)

Coordination: `app/ai/types.py`, `app/agents/base.py`, `app/models/page.py` are the contract surfaces — agree on shape first, parallelize after.
