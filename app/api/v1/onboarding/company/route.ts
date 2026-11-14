export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { dbError } from '@/lib/api-error'
import { flattenText, profanityResponse } from '@/lib/moderation/http'
import { parseBody, readJsonBody } from '@/lib/validation/http'
import { OnboardingCompanyBody } from '@/lib/validation/schemas'

// POST /api/v1/onboarding/company — upsert the caller's own company record.
// user_id comes from the session, never the body. See technical-audit A5.
//
// R-053: only the step-1 fields of the questionnaire are written (whitelist,
// OnboardingCompanyBody is .strict()). partner_id, status, stage, id,
// target_revenue_* and the rest are owned by the server / the staff: a body
// with any of them is a 400 and nothing is written. `user_id` in the body is
// still tolerated and dropped (older clients sent it).
export async function POST(req: NextRequest) {
  try {
    const read = await readJsonBody(req)
    if (!read.ok) return read.response
    const raw = read.value
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'user_id' in raw) {
      delete (raw as Record<string, unknown>).user_id
    }
    const parsed = parseBody(raw, OnboardingCompanyBody)
    if (!parsed.ok) return parsed.response
    // Undefined keys are not sent at all: an update touches only what came.
    const companyData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Partial<OnboardingCompanyBody>
    // Названия и тексты компании: проверяем все строковые поля (и списки — регионы).
    const profane = profanityResponse(flattenText(companyData))
    if (profane) return profane

    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const user_id = user.id

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
      if (!companyData.name) {
        return NextResponse.json(
          { ok: false, error: 'Укажите название компании', code: 'invalid_body', field: 'name' },
          { status: 400 },
        )
      }
      const { data, error } = await sb
        .from('companies')
        .insert({ ...companyData, user_id })
        .select()
        .single()
      result = { data, error }
    }

    if (result.error) return dbError('v1/onboarding/company', result.error)

    return NextResponse.json({ ok: true, data: result.data })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
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
