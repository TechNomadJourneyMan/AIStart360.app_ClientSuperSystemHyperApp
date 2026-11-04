export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { dbError } from '@/lib/api-error'
import { moderateFields } from '@/lib/moderation/guard'

/**
 * Columns a client may set from the onboarding wizard (step 1). The body used
 * to be spread into the insert/update as-is, so a client could write any
 * column (partner_id, target_revenue_*, …). Values keep their current shape —
 * the DB constraints stay the validation for types/enums.
 */
const COMPANY_WRITABLE = [
  'name', 'industry', 'stage', 'size', 'employee_count', 'founded_at', 'business_model', 'regions',
  'contact_name', 'contact_position', 'contact_phone', 'contact_email',
] as const

const TEXT_MAX = 300

function pickCompanyFields(body: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid request body' }
  const src = body as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const key of COMPANY_WRITABLE) {
    if (!(key in src) || src[key] === undefined) continue
    const v = src[key]
    if (typeof v === 'string' && v.length > TEXT_MAX) return { ok: false, error: `Слишком длинное значение: ${key}` }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return { ok: false, error: `Неверное значение: ${key}` }
    data[key] = v
  }
  return { ok: true, data }
}

// POST /api/v1/onboarding/company — upsert the caller's own company record.
// user_id comes from the session, never the body. See technical-audit A5.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const user_id = user.id

  const picked = pickCompanyFields(body)
  if (!picked.ok) return NextResponse.json({ ok: false, error: picked.error }, { status: 400 })
  const companyData = picked.data

  // Фильтр контента: название, отрасль и контактное лицо видят эксперты и
  // персонал — с матом / оскорблениями / спамом запись не сохраняется.
  const rejected = await moderateFields({ userId: user_id, email: user.email ?? null, source: 'company' }, [
    { field: 'name', label: 'Название компании', value: companyData.name, kind: 'name' },
    { field: 'industry', label: 'Отрасль', value: companyData.industry, kind: 'text' },
    { field: 'contact_name', label: 'Контактное лицо', value: companyData.contact_name, kind: 'name' },
    { field: 'contact_position', label: 'Должность контактного лица', value: companyData.contact_position, kind: 'name' },
  ])
  if (rejected) return rejected

  try {
    // Check if company already exists
    const { data: existing } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .single()

    let result
    if (existing) {
      const { data, error } = await sb
        .from('companies')
        .update({ ...companyData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      result = { data, error }
    } else {
      const { data, error } = await sb
        .from('companies')
        .insert({ user_id, ...companyData })
        .select()
        .single()
      result = { data, error }
    }

    if (result.error) return dbError('v1/onboarding/company', result.error)

    return NextResponse.json({ ok: true, data: result.data })
  } catch (err) {
    console.error('[v1/onboarding/company] POST failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить компанию' }, { status: 500 })
  }
}

// GET /api/v1/onboarding/company — the caller's own company (session user only).
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('companies')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return dbError('v1/onboarding/company', error)
  }

  return NextResponse.json({ ok: true, data: data ?? null })
}
