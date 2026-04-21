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

async function uploadFileToStorage(userId: string, file: File): Promise<string | null> {
  const { url, key } = srBase()
  const safeName = file.name.replace(/[^\w.\-]/g, '_')
  const objectPath = `${userId}/medical/${Date.now()}_${safeName}`
  const buf = await file.arrayBuffer()
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
      body: buf,
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

  // ── 3. Upload patient base file if attached ───────────────────────────────
  const file = form.get('patient_base')
  let documentId: string | null = null
  if (file && file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'file too large (>5MB)' }, { status: 400 })
    }
    const storedPath = await uploadFileToStorage(user.id, file)
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
  }

  return NextResponse.json({
    ok: true,
    companyId,
    documentId,
  })
}
