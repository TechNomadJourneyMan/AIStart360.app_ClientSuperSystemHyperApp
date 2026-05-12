export const dynamic = 'force-dynamic'

// POST /api/medical/audit/run  body: { documentId? }
// End-to-end analytical pipeline for the medical vertical:
//   1. Find the latest patient_base document for the caller
//   2. Download + segment patients (RFM)
//   3. Compute 9 bundles with per-clinic numbers
//   4. Compute revenue-loss audit
//   5. Persist: patient_segments rows, growth_bundles rows, revenue_losses rows
// Returns a summary shape that UI (dashboard + expert view) can render.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { segmentPatients } from '@/lib/rfm-segmentation'
import { computeBundles } from '@/lib/clinic-bundles'
import { auditRevenueLosses } from '@/lib/revenue-audit'
import { computeMedicalDiagnostics } from '@/lib/diagnostics-bridge'

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function srGet<T>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

async function srPost(path: string, body: unknown, mergeDuplicates = false): Promise<Response> {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: mergeDuplicates
        ? 'resolution=merge-duplicates,return=minimal'
        : 'return=minimal',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

async function srDelete(path: string): Promise<Response> {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal',
    },
    cache: 'no-store',
  })
}

async function srPatch(path: string, body: unknown): Promise<Response> {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

async function downloadFromStorage(objectPath: string): Promise<ArrayBuffer | null> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/storage/v1/object/documents/${objectPath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.arrayBuffer()
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { documentId?: string } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  // 1. Resolve document (explicit or latest patient_base)
  interface DocRow { id: string; user_id: string; file_name: string; file_url: string; doc_type: string }
  let doc: DocRow | null = null

  if (body.documentId) {
    const rows = await srGet<DocRow[]>(
      `documents?id=eq.${body.documentId}&select=id,user_id,file_name,file_url,doc_type&limit=1`,
    )
    doc = rows?.[0] ?? null
    if (doc && doc.user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  } else {
    const rows = await srGet<DocRow[]>(
      `documents?user_id=eq.${user.id}&doc_type=eq.patient_base&select=id,user_id,file_name,file_url,doc_type&order=uploaded_at.desc&limit=1`,
    )
    doc = rows?.[0] ?? null
  }

  if (!doc) {
    return NextResponse.json({ error: 'no patient_base document found' }, { status: 404 })
  }

  // 2. Download + segment
  const buf = await downloadFromStorage(doc.file_url)
  if (!buf) return NextResponse.json({ error: 'failed to download file' }, { status: 500 })

  const seg = segmentPatients(buf, doc.file_name)
  if (!seg) {
    return NextResponse.json({ error: 'unable to segment (missing phone column?)' }, { status: 422 })
  }

  // 3. Compute bundles + revenue audit
  const bundles = computeBundles(seg)
  const audit = auditRevenueLosses(seg, bundles)

  // 4. Persist — wipe old rows for this client first (simple re-run semantics)
  await srDelete(`patient_segments?client_id=eq.${user.id}`)
  await srDelete(`growth_bundles?client_id=eq.${user.id}`)
  await srDelete(`revenue_losses?client_id=eq.${user.id}`)

  // patient_segments — batched insert (chunks of 500 to stay under PostgREST limit)
  const segRows = seg.patients.map((p) => ({
    client_id: user.id,
    patient_hash: p.patient_hash,
    display_name: p.display_name,
    recency_days: p.recency_days,
    frequency: p.frequency,
    monetary_kzt: p.monetary_kzt,
    segment: p.segment,
    priority: p.priority,
    source_document_id: doc.id,
  }))
  for (let i = 0; i < segRows.length; i += 500) {
    const chunk = segRows.slice(i, i + 500)
    const r = await srPost('patient_segments', chunk)
    if (!r.ok) {
      console.error('[audit/run] patient_segments insert failed', r.status, await r.text().catch(() => ''))
      return NextResponse.json({ error: 'failed to persist segments' }, { status: 500 })
    }
  }

  // growth_bundles
  const bundleRows = bundles.map((b) => ({
    client_id: user.id,
    bundle_key: b.key,
    target_segments: b.target_segments,
    target_patient_count: b.target_patient_count,
    estimated_conversion: b.estimated_conversion,
    estimated_revenue_kzt: b.estimated_revenue_kzt,
    priority: b.priority,
    complexity: b.complexity,
    effect_timeline: b.effect_timeline,
    trigger_description: b.trigger_description,
    script_preview: b.script_preview,
  }))
  const bRes = await srPost('growth_bundles', bundleRows)
  if (!bRes.ok) {
    console.error('[audit/run] growth_bundles insert failed', bRes.status, await bRes.text().catch(() => ''))
  }

  // revenue_losses
  const lossRows = audit.losses.map((l) => ({
    client_id: user.id,
    loss_key: l.key,
    estimated_loss_kzt: l.estimated_loss_kzt,
    severity: l.severity,
    source_data: l.source_data,
    linked_bundle_key: l.linked_bundle_key,
  }))
  const lRes = await srPost('revenue_losses', lossRows)
  if (!lRes.ok) {
    console.error('[audit/run] revenue_losses insert failed', lRes.status, await lRes.text().catch(() => ''))
  }

  // 4b. Bridge: derive Точка А (5 block scores) from medical pipeline output
  // and upsert into `diagnostics` so /dashboard renders live KPI without a
  // separate generic anketa.
  try {
    const companyId = (doc as { company_id?: string | null }).company_id ?? null
    const diag = computeMedicalDiagnostics({
      userId: user.id,
      companyId,
      segments: seg.patients.map((p) => ({
        monetary_kzt: p.monetary_kzt,
        frequency: p.frequency,
        recency_days: p.recency_days,
        segment: p.segment,
      })),
      losses: audit.losses.map((l) => ({
        estimated_loss_kzt: l.estimated_loss_kzt,
        severity: l.severity,
      })),
      bundles: bundles.map((b) => ({
        estimated_revenue_kzt: b.estimated_revenue_kzt,
        target_patient_count: b.target_patient_count,
      })),
    })
    // mark previous diagnostics as not current
    await srPatch(`diagnostics?user_id=eq.${user.id}&is_current=eq.true`, { is_current: false })
    // insert new current row
    await srPost('diagnostics', diag)
  } catch (e) {
    console.error('[audit/run] diagnostics bridge failed (non-fatal):', e)
  }

  // 5. Return condensed summary (UI doesn't need the full patient list)
  return NextResponse.json({
    ok: true,
    documentId: doc.id,
    totals: seg.totals,
    thresholds: seg.thresholds,
    segments: seg.summary,
    bundles,
    audit: {
      total_loss_kzt: audit.total_loss_kzt,
      narrative: audit.narrative,
      losses: audit.losses,
    },
  })
}
