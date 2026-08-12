export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MFA_COOKIE_NAME, verifyStepUp } from '@/lib/mfa/step-up'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'
import { createServiceClient } from '@/lib/supabase-service'

const ADMIN_ROLES = new Set(['admin', 'super_admin'])
const MAX_BODY_BYTES = 16 * 1024
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Origin',
  'X-Content-Type-Options': 'nosniff',
} as const

const textField = (max: number) => z
  .string()
  .trim()
  .min(2)
  .max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))

const CREATE_CLIENT_SCHEMA = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(128)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  fullName: textField(120),
  companyName: textField(160),
  industry: textField(120).optional(),
  stage: z.enum(['Startup', 'Growth', 'Scale', 'Mature']).optional(),
}).strict()

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

function requestIsSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(code)) return code
  }
  return error instanceof Error ? error.name : 'unknown'
}

function isDuplicateEmailError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown }
  if (
    candidate.code === 'email_exists'
    || candidate.code === 'user_already_exists'
    || candidate.code === 'email_address_not_unique'
  ) {
    return true
  }
  if (candidate.status !== 400 && candidate.status !== 422) return false
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  return message.includes('already registered') || message.includes('already been registered')
}

async function compensateCreatedUser(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<void> {
  try {
    const { error } = await service.auth.admin.deleteUser(userId)
    if (error) {
      console.error('[admin/clients] auth compensation failed', {
        errorCode: safeErrorCode(error),
      })
    }
  } catch (error) {
    console.error('[admin/clients] auth compensation failed', {
      errorCode: safeErrorCode(error),
    })
  }
}

// POST /api/v1/admin/clients — admin-side client creation (bypasses email
// confirmation). Admin only. See technical-audit A1.
export async function POST(req: NextRequest) {
  try {
    const guard = await requireSupabaseAdmin()
    if ('error' in guard) return guard.error

    if (!requestIsSameOrigin(req)) {
      return json({ ok: false, error: 'invalid_origin' }, 403)
    }

    const service = createServiceClient()
    const profileResult = await service
      .from('profiles')
      .select('role, status')
      .eq('id', guard.user.id)
      .maybeSingle()

    if (profileResult.error) {
      return json({ ok: false, error: 'authorization_unavailable' }, 503)
    }
    const trustedProfile = profileResult.data as { role?: unknown; status?: unknown } | null
    if (
      typeof trustedProfile?.role !== 'string'
      || !ADMIN_ROLES.has(trustedProfile.role)
      || trustedProfile.status !== 'approved'
    ) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }

    const enrollmentResults = await Promise.all([
      service
        .from('user_security')
        .select('totp_enabled')
        .eq('user_id', guard.user.id)
        .maybeSingle(),
      service
        .from('webauthn_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', guard.user.id),
    ]).catch(() => null)
    if (!enrollmentResults) {
      return json({ ok: false, error: 'authorization_unavailable' }, 503)
    }
    const [totpResult, passkeyResult] = enrollmentResults
    if (totpResult.error || passkeyResult.error) {
      return json({ ok: false, error: 'authorization_unavailable' }, 503)
    }
    const enrolled = totpResult.data?.totp_enabled === true || (passkeyResult.count ?? 0) > 0
    if (!enrolled) {
      return json({ ok: false, error: 'mfa_enrollment_required' }, 403)
    }
    if (!verifyStepUp(req.cookies.get(MFA_COOKIE_NAME)?.value, guard.user.id)) {
      return json({ ok: false, error: 'mfa_step_up_required' }, 403)
    }

    if (await isRateLimitedKey(guard.user.id, 'admin:client-create', {
      max: 5,
      windowMs: 10 * 60_000,
    })) {
      return json({ ok: false, error: 'rate_limited' }, 429)
    }

    const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return json({ ok: false, error: 'unsupported_media_type' }, 415)
    }
    const contentLength = req.headers.get('content-length')
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'request_too_large' }, 413)
    }

    const rawBody = await req.text()
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'request_too_large' }, 413)
    }
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return json({ ok: false, error: 'invalid_request' }, 400)
    }
    const parsed = CREATE_CLIENT_SCHEMA.safeParse(body)
    if (!parsed.success) {
      return json({ ok: false, error: 'invalid_request' }, 400)
    }
    const { email, password, fullName, companyName, industry, stage } = parsed.data

    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'client', status: 'approved', vertical: 'ecommerce' },
      user_metadata: {
        full_name: fullName,
        organization: companyName,
        vertical: 'ecommerce',
      },
    })
    if (authError) {
      if (isDuplicateEmailError(authError)) {
        return json({ ok: false, error: 'email_already_exists' }, 409)
      }
      console.error('[admin/clients] auth creation failed', {
        errorCode: safeErrorCode(authError),
      })
      return json({ ok: false, error: 'client_creation_failed' }, 500)
    }
    const createdUser = authData?.user
    if (!createdUser) {
      console.error('[admin/clients] auth creation returned no user')
      return json({ ok: false, error: 'client_creation_failed' }, 500)
    }

    let profileError: unknown = null
    try {
      const result = await service.from('profiles').upsert({
        id: createdUser.id,
        email,
        full_name: fullName,
        organization: companyName,
        role: 'client',
        status: 'approved',
        vertical: 'ecommerce',
        approved_at: new Date().toISOString(),
        approved_by: guard.user.id,
      }, { onConflict: 'id' })
      profileError = result.error
    } catch (error) {
      profileError = error
    }
    if (profileError) {
      console.error('[admin/clients] profile creation failed', {
        errorCode: safeErrorCode(profileError),
      })
      await compensateCreatedUser(service, createdUser.id)
      return json({ ok: false, error: 'client_creation_failed' }, 500)
    }

    let companyError: unknown = null
    try {
      const result = await service.from('companies').insert({
        user_id: createdUser.id,
        name: companyName,
        ...(industry ? { industry } : {}),
        ...(stage    ? { stage }    : {}),
      })
      companyError = result.error
    } catch (error) {
      companyError = error
    }
    if (companyError) {
      console.error('[admin/clients] company creation failed', {
        errorCode: safeErrorCode(companyError),
      })
      await compensateCreatedUser(service, createdUser.id)
      return json({ ok: false, error: 'client_creation_failed' }, 500)
    }

    return json({ ok: true }, 201)
  } catch (error) {
    console.error('[admin/clients] unexpected failure', {
      errorCode: safeErrorCode(error),
    })
    return json({ ok: false, error: 'client_creation_failed' }, 500)
  }
}

export interface AdminClientRow {
  id: string
  email: string
  full_name: string | null
  status: string
  approved_at: string | null
  created_at: string
  company_name: string | null
  industry: string | null
  stage: string | null
  overall_score: number | null   // 0–100 from Point A engine
  health_index: number | null
  finance_score: number | null
  sales_score: number | null
  operations_score: number | null
  marketing_score: number | null
  strategy_score: number | null
  calculated_at: string | null
}

// GET /api/v1/admin/clients — admin only. See technical-audit A1.
export async function GET() {
  try {
    const guard = await requireSupabaseAdmin()
    if ('error' in guard) return guard.error

    const sb = createServerClient()

    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, email, full_name, status, approved_at, created_at')
      .not('status', 'eq', 'rejected')
      .order('created_at', { ascending: false })

    if (error) throw error
    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ ok: true, data: [] })
    }

    const userIds = profiles.map((p) => p.id)

    // Fetch companies and current diagnostics in parallel
    const [companiesRes, diagnosticsRes] = await Promise.all([
      sb
        .from('companies')
        .select('user_id, name, industry, stage')
        .in('user_id', userIds),
      sb
        .from('diagnostics')
        .select('user_id, overall_score, health_index, finance_score, sales_score, operations_score, marketing_score, strategy_score, calculated_at')
        .in('user_id', userIds)
        .eq('is_current', true),
    ])

    const companyMap = new Map(
      (companiesRes.data ?? []).map((c) => [c.user_id, c])
    )
    const diagnosticMap = new Map(
      (diagnosticsRes.data ?? []).map((d) => [d.user_id, d])
    )

    const rows: AdminClientRow[] = profiles.map((p) => {
      const company = companyMap.get(p.id)
      const diag = diagnosticMap.get(p.id)

      const blockScore = (block: Record<string, unknown> | null) =>
        block && typeof block === 'object' && 'score' in block
          ? (block.score as number)
          : null

      return {
        id: p.id,
        email: p.email,
        full_name: p.full_name ?? null,
        status: p.status,
        approved_at: p.approved_at ?? null,
        created_at: p.created_at,
        company_name: company?.name ?? null,
        industry: company?.industry ?? null,
        stage: company?.stage ?? null,
        overall_score: diag?.overall_score ?? null,
        health_index: diag?.health_index ?? null,
        finance_score: blockScore(diag?.finance_score as Record<string, unknown> | null),
        sales_score: blockScore(diag?.sales_score as Record<string, unknown> | null),
        operations_score: blockScore(diag?.operations_score as Record<string, unknown> | null),
        marketing_score: blockScore(diag?.marketing_score as Record<string, unknown> | null),
        strategy_score: blockScore(diag?.strategy_score as Record<string, unknown> | null),
        calculated_at: diag?.calculated_at ?? null,
      }
    })

    return NextResponse.json({ ok: true, data: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
