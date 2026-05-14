export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/diagnostics/recalculate-from-files
 *
 * Reads ai_extractions (metric.* entities sourced from documents) for the
 * current user, runs the financial-bridge mapper → upserts a fresh
 * diagnostics row with block_scores derived from uploaded files.
 *
 * Idempotent: re-run anytime; supersedes previous "files-sourced" diagnostic.
 * Survey-based diagnostic (from /onboarding) is independent — both can coexist
 * (we keep is_current = true on the most recent one).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { bridgeFinancialExtractions, type ExtractionRow } from '@/lib/financial-bridge'

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function srFetch(path: string, init: RequestInit = {}) {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()

  // Allow service-role callers (orchestrator stamp step) to pass user_id explicitly.
  let userId = user?.id ?? null
  try {
    const body = await req.json()
    if (body?.user_id && typeof body.user_id === 'string') {
      // Only honor body.user_id if no session — i.e. server-internal call
      if (!userId) userId = body.user_id
    }
  } catch { /* empty body ok */ }

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  // Pull all metric.* extractions from documents for this user.
  // Filter superseded out, take only metric entities.
  const extRes = await srFetch(
    `ai_extractions?user_id=eq.${userId}&superseded_by=is.null&entity_type=like.metric.*&select=entity_type,value,unit,period_year,period_quarter,source_type,source_doc_id,extractor_name,extracted_at,confidence&order=extracted_at.desc&limit=2000`
  )
  if (!extRes.ok) {
    const text = await extRes.text().catch(() => '')
    return NextResponse.json({ ok: false, error: `extractions fetch failed: ${text}` }, { status: 500 })
  }
  const extractions = await extRes.json() as ExtractionRow[]
  const docOnly = extractions.filter((e) => (e.source_type ?? '').toLowerCase().includes('document') || (e.source_type ?? '') === 'document' || (e.source_type ?? '').includes('financial') || (e.source_type ?? '').includes('crm'))

  if (docOnly.length === 0 && extractions.length > 0) {
    // Fallback: if nothing tagged as 'document', use all metric extractions
    // (some extractors set source_type='financial_pdf' or similar)
  }
  const inputRows = docOnly.length > 0 ? docOnly : extractions

  const bridged = bridgeFinancialExtractions(inputRows)

  // Find company_id for this user
  const compRes = await srFetch(`companies?user_id=eq.${userId}&select=id&limit=1`)
  let companyId: string | null = null
  if (compRes.ok) {
    const rows = await compRes.json() as Array<{ id: string }>
    companyId = rows[0]?.id ?? null
  }

  // Mark previous diagnostic as not current
  await srFetch(`diagnostics?user_id=eq.${userId}&is_current=eq.true`, {
    method: 'PATCH',
    body: JSON.stringify({ is_current: false }),
  })

  // Insert new diagnostic
  const diagRow = {
    user_id: userId,
    company_id: companyId,
    overall_score: bridged.overall_score,
    health_index: bridged.health_index,
    stage: bridged.stage,
    finance_score: bridged.blocks.finance,
    sales_score: bridged.blocks.sales,
    marketing_score: bridged.blocks.marketing,
    operations_score: bridged.blocks.operations,
    strategy_score: bridged.blocks.strategy,
    risks: [],
    insights: bridged.insights,
    quick_wins: [],
    data_gaps: bridged.data_gaps,
    is_current: true,
    ai_status: 'none',
    source: 'files',
  }

  const insRes = await srFetch('diagnostics', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(diagRow),
  })
  if (!insRes.ok) {
    const text = await insRes.text().catch(() => '')
    // If 'source' column doesn't exist, retry without it
    if (text.includes('source')) {
      const retry = { ...diagRow }
      delete (retry as Record<string, unknown>).source
      const retryRes = await srFetch('diagnostics', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(retry),
      })
      if (!retryRes.ok) {
        return NextResponse.json({ ok: false, error: await retryRes.text() }, { status: 500 })
      }
      const inserted = await retryRes.json()
      return NextResponse.json({ ok: true, evidence: bridged.evidence_total, diagnostic: inserted[0], bridged })
    }
    return NextResponse.json({ ok: false, error: text }, { status: 500 })
  }
  const inserted = await insRes.json()
  return NextResponse.json({ ok: true, evidence: bridged.evidence_total, diagnostic: inserted[0], bridged })
}
