# AI pipeline tests

Quick reference for everything that should be tested across Phases 0-6.

## Unit tests (this folder)

Run with:

```bash
npm test tests/ai-pipeline
```

Requires **Node 20.12+** (vitest/rolldown dep). If local node is older, run via CI.

| File | Covers |
|---|---|
| `base.test.ts` | `coerceNumber`, `parsePeriod`, `matchColumn`, `excerpt`, `makeEntity`, source-priority constants |
| `consensus.test.ts` | Winner selection, supersede markings, gap thresholds, conflict resolution, `winnersToMetrics` projection |
| `document-hash.test.ts` | `hashBytes` determinism + different inputs, `hashSurveyAnswers` key-order invariance, `shortHash` |
| `registry.test.ts` | Dispatch routing (generic / medical / fallback), `listExtractors`, all Phase 2+4 extractors registered |
| `survey-extractor.test.ts` | Question-key → entity-type mapping, period extraction, number coercion, unknown keys skipped, medical fields |

## Integration tests (future)

Should be added in `tests/integration/ai-pipeline/`. Needs live Supabase
(migration 016 applied) + Claude key.

- `recalculate-survey.test.ts` — hit `/api/v1/diagnostics/recalculate`, assert `ai_runs` completed + metrics written.
- `document-upload.test.ts` — POST `/api/v1/onboarding/documents` with a seed xlsx, assert extractor ran + classified_type patched.
- `consensus-doc-vs-survey.test.ts` — upload document with revenue 12M, survey answer 10M → conflict registered, document wins.

## E2E smoke (CLI script)

```bash
DATABASE_URL=... \
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
ANTHROPIC_API_KEY=... \
AI_BACKBONE=inline \
USER_ID=<seed-user-uuid> \
COMPANY_ID=<seed-company-uuid> \
npx tsx scripts/ai-pipeline-smoke.ts
```

Runs the survey pipeline against a real Supabase and prints:
- ai_runs row status + steps + cost
- ai_extractions counts by entity_type
- metrics rows for the company (source=calculated)
- recent ai_conflicts

## Manual UI checks per preview

For each async-backbone preview (`ai-pipeline-inngest`, `ai-pipeline-n8n`):

1. **Survey completion flow**
   - Log in as a test client with completed anketa
   - Open `/client/onboarding` → last step → "Пересчитать"
   - Watch `AiProgressStrip` transitions running → completed
   - Check `/data-quality` — should be empty if only survey source

2. **Document upload flow**
   - Upload a sales_report.xlsx to `/client/onboarding/documents`
   - Confirm response has `ai_run_id`
   - Open page with `<AiProgressStrip runId={...}>` — watch 6 steps
   - Check `/data-quality` — if doc revenue ≠ survey revenue by > 20%, expect conflict

3. **Medical flow (Sau Zhurek seed)**
   - Log in as clinic owner
   - Upload `patient_base.xlsx` (2747 patients)
   - Navigate to medical dashboard
   - Verify:
     - `SegmentationCard` shows 8 segments with real counts (36 VIP etc.)
     - `BundlesRoadmap` shows 9 bundles ordered by priority, ~₸10.985M total uplift
     - `RevenueLossMap` shows 9 losses ~₸13.3M monthly total

4. **Admin surfaces**
   - Open `/admin/ai-budget` — shows today's spend vs $50 default
   - Force a conflict: POST `/api/v1/admin/ai/reextract` with company_id → new ai_run

## Manual DB verification

After a full pipeline run:

```sql
-- Recent runs
SELECT status, backbone, jsonb_array_length(steps) AS steps, total_cost_usd,
       started_at, finished_at
FROM ai_runs ORDER BY started_at DESC LIMIT 10;

-- Active extractions for a company
SELECT entity_type, value, confidence, source_type, extractor_name
FROM ai_extractions
WHERE company_id = '<uuid>' AND superseded_by IS NULL
ORDER BY extracted_at DESC;

-- Canonical metrics
SELECT metric_key, metric_value, period_year, source
FROM metrics WHERE company_id = '<uuid>'
ORDER BY metric_key, period_year;

-- Pending conflicts
SELECT entity_type, resolution, jsonb_array_length(contenders) AS contenders
FROM ai_conflicts WHERE company_id = '<uuid>' AND resolution = 'pending';

-- Medical
SELECT segment, COUNT(*) FROM patient_segments WHERE client_id = '<uuid>' GROUP BY segment ORDER BY COUNT(*) DESC;
SELECT bundle_key, estimated_revenue_kzt, priority FROM growth_bundles WHERE client_id = '<uuid>' ORDER BY priority;
SELECT loss_key, estimated_loss_kzt, severity FROM revenue_losses WHERE client_id = '<uuid>' ORDER BY estimated_loss_kzt DESC;
```

## Comparing inngest vs n8n preview

After phases 0-6 deploy to both preview URLs:

| Metric | How to capture |
|---|---|
| Avg end-to-end run latency | `SELECT avg(EXTRACT(EPOCH FROM (finished_at - started_at))) FROM ai_runs WHERE backbone = 'inngest'/'n8n'` |
| Cost per run | `SELECT avg(total_cost_usd) FROM ai_runs WHERE ...` |
| Failure rate on 50 seeded files | `SELECT 1.0 * COUNT(*) FILTER (WHERE status='failed') / COUNT(*) FROM ai_runs WHERE started_at > NOW() - INTERVAL '1 hour'` |
| Retry correctness | Kill Claude key mid-run, re-enable, check Inngest retry (aiOrchestrate retries=2) / n8n node retry |
| Dev experience (subjective 1-5) | How fast to add a new extractor and see it run |

Winner merges → main. Loser archived.
