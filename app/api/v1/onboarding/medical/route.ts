export const dynamic = 'force-dynamic'

// POST /api/v1/onboarding/medical
// Saves the clinic intake anketa (8 fields) and optionally uploads a patient
// base file. Writes to:
//   1. companies (name = clinic_name, contact_*, stage='Growth' as MVP default)
//   2. survey_answers (step=0, one row per field)
//   3. documents + Supabase Storage bucket 'documents' (if file attached,
//      doc_type='patient_base')
//
// Phase-1 scope: only persist data. RFM segmentation + revenue audit kick off
// in a follow-up job (chunk 5) — endpoint just returns { ok: true, companyId }.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { MEDICAL_INTAKE_FIELDS } from '@/lib/intake-schemas'
import { validatePatientBase, type DataQualityReport } from '@/lib/data-quality'
import { orchestrate } from '@/lib/ai/orchestrator'
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

async function srPost(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

async function srDelete(path: string): Promise<Response> {
  const { url, key } = srBase()
  return fetch(`${url}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
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

async function uploadFileToStorage(
  userId: string,
  file: File,
  preReadBuffer?: Buffer,
): Promise<string | null> {
  const { url, key } = srBase()
  const safeName = file.name.replace(/[^\w.\-]/g, '_')
  const objectPath = `${userId}/medical/${Date.now()}_${safeName}`
  const buf = preReadBuffer ?? Buffer.from(await file.arrayBuffer())
  // Copy into a fresh ArrayBuffer so DOM BlobPart typing is satisfied
  const ab = new ArrayBuffer(buf.byteLength)
  new Uint8Array(ab).set(buf)
  const body = new Blob([ab], { type: file.type || 'application/octet-stream' })
  const res = await fetch(
    `${url}/storage/v1/object/documents/${objectPath}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body,
    },
  )
  if (!res.ok) {
    console.error('[onboarding/medical] storage upload failed', res.status, await res.text().catch(() => ''))
    return null
  }
  return objectPath
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  let answers: Record<string, string> = {}
  try {
    const raw = form.get('answers')
    if (typeof raw !== 'string') throw new Error('answers missing')
    answers = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid answers' }, { status: 400 })
  }

  // ── Validate required fields ───────────────────────────────────────────────
  for (const f of MEDICAL_INTAKE_FIELDS) {
    if (!f.required || f.type === 'file') continue
    if (!(answers[f.key] ?? '').trim()) {
      return NextResponse.json({ error: `missing required field: ${f.key}` }, { status: 400 })
    }
  }

  // ── 1. Upsert companies row ───────────────────────────────────────────────
  const clinicName = answers.clinic_name?.trim() || 'Клиника'
  const companyPayload = {
    user_id: user.id,
    name: clinicName,
    industry: 'medical',
    stage: 'Growth' as const,            // sensible MVP default for most clinics
    business_model: 'B2C' as const,
    contact_name: answers.full_name?.trim() || null,
    contact_phone: answers.phone?.trim() || null,
    contact_email: answers.email?.trim() || null,
  }

  // Check if row exists
  const { url, key } = srBase()
  const existRes = await fetch(
    `${url}/rest/v1/companies?user_id=eq.${user.id}&select=id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
  )
  const existing = existRes.ok ? (await existRes.json()) as Array<{ id: string }> : []

  let companyId: string
  if (existing.length > 0) {
    companyId = existing[0].id
    const upd = await fetch(`${url}/rest/v1/companies?id=eq.${companyId}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(companyPayload),
    })
    if (!upd.ok) {
      console.error('[onboarding/medical] company update failed', upd.status)
      return NextResponse.json({ error: 'failed to save company' }, { status: 500 })
    }
  } else {
    const ins = await srPost('companies', companyPayload)
    if (!ins.ok) {
      console.error('[onboarding/medical] company insert failed', ins.status, await ins.text().catch(() => ''))
      return NextResponse.json({ error: 'failed to save company' }, { status: 500 })
    }
    const rows = (await ins.json()) as Array<{ id: string }>
    companyId = rows[0].id
  }

  // ── 2. Upsert survey_answers (one row per field, step=0) ──────────────────
  const rowsToUpsert = MEDICAL_INTAKE_FIELDS
    .filter((f) => f.type !== 'file')
    .map((f) => ({
      user_id: user.id,
      company_id: companyId,
      step: 0,
      question_key: `medical_${f.answerKey}`,
      answer: { value: answers[f.key] ?? '' },
    }))

  const surveyRes = await fetch(`${url}/rest/v1/survey_answers?on_conflict=user_id,question_key`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rowsToUpsert),
  })
  if (!surveyRes.ok) {
    console.error('[onboarding/medical] survey upsert failed', surveyRes.status, await surveyRes.text().catch(() => ''))
    return NextResponse.json({ error: 'failed to save answers' }, { status: 500 })
  }

  // ── 3. Upload patient base file if attached + validate ────────────────────
  const file = form.get('patient_base')
  let documentId: string | null = null
  let qualityReport: DataQualityReport | null = null

  if (file && file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'file too large (>5MB)' }, { status: 400 })
    }

    // Read buffer once — we use it for BOTH upload AND validation (no 2nd download)
    const buf = Buffer.from(await file.arrayBuffer())

    // Upload to Storage
    const storedPath = await uploadFileToStorage(user.id, file, buf)
    if (storedPath) {
      const docRes = await srPost('documents', {
        user_id: user.id,
        company_id: companyId,
        file_name: file.name,
        file_url: storedPath,
        file_size: file.size,
        mime_type: file.type || null,
        doc_type: 'patient_base',
      })
      if (docRes.ok) {
        const rows = (await docRes.json()) as Array<{ id: string }>
        documentId = rows[0]?.id ?? null
      } else {
        console.error('[onboarding/medical] document insert failed', docRes.status, await docRes.text().catch(() => ''))
      }
    }

    // Validate in-memory (no need to re-download)
    try {
      qualityReport = validatePatientBase(buf, file.name)
    } catch (e) {
      console.error('[onboarding/medical] validation error', e)
    }
  }

  // ── 4. Kick off AI orchestrator (parse/classify/extract pipeline) ──
  let aiRunId: string | undefined
  if (documentId) {
    try {
      const res = await orchestrate({
        trigger: 'document_uploaded',
        userId: user.id,
        companyId,
        documentId,
        triggerEntity: `documents.${documentId}`,
        verticalHint: 'medical',
      })
      aiRunId = res.runId
    } catch (e) {
      console.error('[onboarding/medical] orchestrator dispatch failed', e)
    }
  }

  // ── 5. Full medical audit pipeline (RFM + bundles + losses + Точка А bridge) ──
  // Runs synchronously here so by the time the user lands on /dashboard the
  // diagnostics row + segments are ready (no separate audit step needed).
  let auditOk = false
  const fileForAudit = form.get('patient_base')
  if (fileForAudit instanceof File && fileForAudit.size > 0 && documentId) {
    try {
      const buf2 = Buffer.from(await fileForAudit.arrayBuffer())
      const seg = segmentPatients(buf2, fileForAudit.name)
      if (seg) {
        const bundlesOut = computeBundles(seg)
        const auditOut = auditRevenueLosses(seg, bundlesOut)

        // Clean previous rows for this client
        await srDelete(`patient_segments?client_id=eq.${user.id}`)
        await srDelete(`growth_bundles?client_id=eq.${user.id}`)
        await srDelete(`revenue_losses?client_id=eq.${user.id}`)

        // patient_segments — chunked
        const segRows = seg.patients.map((p) => ({
          client_id: user.id,
          patient_hash: p.patient_hash,
          display_name: p.display_name,
          recency_days: p.recency_days,
          frequency: p.frequency,
          monetary_kzt: p.monetary_kzt,
          segment: p.segment,
          priority: p.priority,
          source_document_id: documentId,
        }))
        for (let i = 0; i < segRows.length; i += 500) {
          await srPost('patient_segments', segRows.slice(i, i + 500), { Prefer: 'return=minimal' })
        }

        const bundleRows = bundlesOut.map((b) => ({
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
        await srPost('growth_bundles', bundleRows, { Prefer: 'return=minimal' })

        const lossRows = auditOut.losses.map((l) => ({
          client_id: user.id,
          loss_key: l.key,
          estimated_loss_kzt: l.estimated_loss_kzt,
          severity: l.severity,
          source_data: l.source_data,
          linked_bundle_key: l.linked_bundle_key,
        }))
        await srPost('revenue_losses', lossRows, { Prefer: 'return=minimal' })

        // Bridge → diagnostics for /dashboard Точка А
        const diag = computeMedicalDiagnostics({
          userId: user.id,
          companyId,
          segments: seg.patients.map((p) => ({
            monetary_kzt: p.monetary_kzt,
            frequency: p.frequency,
            recency_days: p.recency_days,
            segment: p.segment,
          })),
          losses: auditOut.losses.map((l) => ({
            estimated_loss_kzt: l.estimated_loss_kzt,
            severity: l.severity,
          })),
          bundles: bundlesOut.map((b) => ({
            estimated_revenue_kzt: b.estimated_revenue_kzt,
            target_patient_count: b.target_patient_count,
          })),
        })
        await srPatch(`diagnostics?user_id=eq.${user.id}&is_current=eq.true`, { is_current: false })
        await srPost('diagnostics', diag, { Prefer: 'return=minimal' })
        auditOk = true
      }
    } catch (e) {
      console.error('[onboarding/medical] audit pipeline failed (non-fatal):', e)
    }
  }

  return NextResponse.json({
    ok: true,
    companyId,
    documentId,
    qualityReport,
    aiRunId,
    auditOk,
  })
}
