/**
 * AI-pipeline smoke test — run against a live Supabase + Claude env.
 *
 * Usage:
 *   DATABASE_URL=... \
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   ANTHROPIC_API_KEY=... \
 *   AI_BACKBONE=inline \
 *   USER_ID=<real profile uuid> \
 *   COMPANY_ID=<real company uuid> \
 *   npx tsx scripts/ai-pipeline-smoke.ts
 *
 * What it does:
 *   1. Calls orchestrate({trigger: 'survey_completed'}) — exercises the
 *      full inline path: survey load → extract → persist → consensus.
 *   2. Fetches ai_runs, ai_extractions, ai_conflicts, metrics for the
 *      given company and prints a compact summary.
 *
 * Non-destructive — only writes ai_runs + ai_extractions + metrics
 * rows that would be written on a normal survey submission.
 */

import { orchestrate } from '../lib/ai/orchestrator'

async function main(): Promise<void> {
  const userId = process.env.USER_ID
  const companyId = process.env.COMPANY_ID
  if (!userId || !companyId) {
    console.error('Set USER_ID and COMPANY_ID env vars')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log('→ orchestrate({ trigger: survey_completed })')
  const start = Date.now()
  const result = await orchestrate({
    trigger: 'survey_completed',
    userId,
    companyId,
    triggerEntity: 'smoke-test',
  })
  const dur = Date.now() - start

  console.log(`  runId=${result.runId} backbone=${result.backbone} inline=${result.inline} ${dur}ms`)

  // Fetch the run
  const runRes = await fetch(`${url}/rest/v1/ai_runs?id=eq.${result.runId}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const runs = (await runRes.json()) as Array<{
    status: string
    steps: Array<{ name: string; status: string; meta?: Record<string, unknown> }>
    total_cost_usd: number | null
    error: string | null
  }>
  const run = runs[0]
  if (!run) {
    console.error('  FAIL: ai_runs row not found')
    process.exit(1)
  }

  console.log(`  status=${run.status} cost=$${run.total_cost_usd ?? 0}`)
  for (const step of run.steps ?? []) {
    console.log(`    ${step.status === 'completed' ? '✓' : '✗'} ${step.name}`, step.meta ?? {})
  }

  if (run.error) {
    console.log(`  ERROR: ${run.error}`)
    process.exit(1)
  }

  // Fetch extractions
  const extractRes = await fetch(
    `${url}/rest/v1/ai_extractions?run_id=eq.${result.runId}&select=entity_type,value,confidence,period_year&order=entity_type`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )
  const extracts = (await extractRes.json()) as Array<{
    entity_type: string
    value: unknown
    confidence: number
    period_year: number | null
  }>
  console.log(`→ ai_extractions: ${extracts.length} rows`)
  const byType = new Map<string, number>()
  for (const e of extracts) {
    byType.set(e.entity_type, (byType.get(e.entity_type) ?? 0) + 1)
  }
  for (const [type, count] of byType) {
    console.log(`    ${type}: ${count}`)
  }

  // Fetch metrics
  const metRes = await fetch(
    `${url}/rest/v1/metrics?company_id=eq.${companyId}&source=eq.calculated&select=metric_key,metric_value,period_year`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )
  const mets = (await metRes.json()) as Array<{
    metric_key: string
    metric_value: number
    period_year: number | null
  }>
  console.log(`→ metrics (source=calculated): ${mets.length} rows`)
  for (const m of mets.slice(0, 10)) {
    console.log(
      `    ${m.metric_key}${m.period_year ? ` ${m.period_year}` : ''}: ${m.metric_value.toLocaleString('ru-RU')}`
    )
  }
  if (mets.length > 10) console.log(`    ... and ${mets.length - 10} more`)

  // Fetch conflicts
  const confRes = await fetch(
    `${url}/rest/v1/ai_conflicts?company_id=eq.${companyId}&select=entity_type,resolution,period_year&order=created_at.desc&limit=10`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )
  const conflicts = (await confRes.json()) as Array<{
    entity_type: string
    resolution: string
    period_year: number | null
  }>
  console.log(`→ ai_conflicts: ${conflicts.length} recent`)
  for (const c of conflicts) {
    console.log(`    ${c.resolution.padEnd(8)} ${c.entity_type}${c.period_year ? ' ' + c.period_year : ''}`)
  }

  console.log('\n✓ smoke OK')
}

main().catch((err) => {
  console.error('\n✗ smoke FAIL:', err)
  process.exit(1)
})
