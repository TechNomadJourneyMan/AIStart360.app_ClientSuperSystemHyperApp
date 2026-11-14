export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { checkRateLimitForRequest, isRateLimitedKey, rateLimitResponse } from '@/lib/rate-limit'
import { notifyAdmins } from '@/lib/notifications'
import { runInBackground } from '@/lib/background'
import { profanityResponse } from '@/lib/moderation/http'
import { dbError } from '@/lib/api-error'
import { parseJsonBody } from '@/lib/validation/http'
import { ClientRegisterBody } from '@/lib/validation/schemas'

/**
 * POST /api/client/register
 * Called after Supabase Auth signup succeeds.
 * Creates:
 *   1. A row in public.profiles (safety net — trigger may have already created it)
 *   2. A row in public.companies
 *   3. An AdminRequest record via Prisma (so GIGA-panel sees the request)
 *      Falls back to direct Supabase insert if Prisma fails.
 *   4. Tells the admins (notifyAdmins 'user_registered' — Telegram / email,
 *      honours the GIGA toggle), after the response, never with secrets.
 *
 * Body: { userId?, email?, name?, company? } (ClientRegisterBody, .strict()).
 *
 * R-053:
 *   - identity is the session's: the id and the e-mail written to profiles and
 *     to the request are auth.users', the body's `email` is ignored and a
 *     body `userId` other than the session's is a 403;
 *   - idempotent: a repeated call finds the user's company and registration
 *     request and creates neither again (200 with the same requestId, no new
 *     notification); a first call answers 201;
 *   - a failed write is an error (500), not a silent success.
 */
export async function POST(req: NextRequest) {
  try {
    const ipLimit = await checkRateLimitForRequest(req, 'client-register-ip', { max: 20, windowMs: 10 * 60_000 })
    if (ipLimit.limited) return rateLimitResponse(ipLimit)
    const parsed = await parseJsonBody(req, ClientRegisterBody)
    if (!parsed.ok) return parsed.response
    const { userId: bodyUserId, name: bodyName, company: bodyCompany } = parsed.data
    const name = bodyName || ''
    const company = bodyCompany || ''

    const profane = profanityResponse({ name, company })
    if (profane) return profane

    const supabaseAdmin = createServerClient()

    // SEC-04: this endpoint upserts a profile and enqueues an approval request
    // (admin_requests). It previously trusted the body-supplied `userId` with no
    // auth, so an anonymous caller could spam the approval queue / upsert
    // arbitrary profiles. Require an authenticated session, only allow acting on
    // the caller's OWN id, and rate-limit. The register page always calls this
    // with a live session whose id === userId, so the legit flow is unaffected.
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (bodyUserId && authUser.id !== bodyUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (await isRateLimitedKey(authUser.id, 'client-register', { max: 5, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }
    const userId = authUser.id
    // R-053: the e-mail is the account's, never the body's.
    const email = authUser.email ?? ''
    const displayName = name || email

    // 1. Ensure profile exists (trigger on auth.users INSERT may have created
    //    it). Do NOT set status here — the handle_new_user trigger / column
    //    default own the initial value, and OPEN registration mode may have
    //    already approved this user; forcing pending_approval would downgrade it.
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        ...(email ? { email } : {}),
        ...(displayName ? { full_name: displayName } : {}),
        // role/status are owned by handle_new_user + service-role routes; the
        // guard trigger (migration 084) rejects any change from a user session.
      },
      { onConflict: 'id' }
    )
    if (profileError) return dbError('client/register:profile', profileError)

    // If the user is already approved (OPEN registration mode) there is no
    // approval request to create.
    const { data: prof, error: profReadError } = await supabaseAdmin
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle()
    if (profReadError) return dbError('client/register:status', profReadError)
    const alreadyApproved = prof?.status === 'approved'

    // 2. Company record — once per user (companies_user_id_uidx, migration 013).
    let companyCreated = false
    let companyExisted = false
    if (company) {
      const { data: existingCompany, error: companyReadError } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
      if (companyReadError) return dbError('client/register:company-read', companyReadError)
      if (existingCompany) {
        companyExisted = true
      } else {
        const { error: companyError } = await supabaseAdmin.from('companies').insert({
          user_id: userId,
          name: company,
        })
        // 23505: a parallel call inserted it first — that is the same company.
        if (companyError && companyError.code !== '23505') return dbError('client/register:company', companyError)
        companyCreated = !companyError
        companyExisted = Boolean(companyError)
      }
    }

    // 3. Create AdminRequest — try Prisma first, fallback to direct Supabase
    //    insert. Skipped entirely in OPEN mode (nothing to approve), and when
    //    the user already has a registration request (a repeated call).
    let requestId: string | null = null
    let requestCreated = false

    if (!alreadyApproved) {
      requestId = await findRegistrationRequest(userId)
    }

    if (!alreadyApproved && !requestId) {
    const requestPayload = {
      userId,
      email,
      name: displayName,
      company,
      subject: `Регистрация: ${displayName}`,
      description: `Новая заявка на регистрацию от ${displayName}${company ? ` (${company})` : ''}`,
    }

    try {
      const adminRequest = await prisma.adminRequest.create({
        data: {
          type: 'registration',
          status: 'new',
          priority: 'medium',
          source: 'client_portal',
          payload: requestPayload,
        },
      })
      requestId = adminRequest.id
      requestCreated = true
    } catch (prismaError) {
      console.warn('[client/register] Prisma failed, falling back to Supabase insert:', prismaError)

      // Fallback: insert directly into admin_requests table via Supabase
      // (same physical PostgreSQL database, bypasses Prisma connection issues)
      const fallbackId = crypto.randomUUID()
      const now = new Date().toISOString()

      // Service role: admin_requests is a Prisma table closed to anon /
      // authenticated (migration 084); the caller was verified above.
      const { error: fbError } = await createServiceClient().from('admin_requests').insert({
        id: fallbackId,
        type: 'registration',
        status: 'new',
        priority: 'medium',
        source: 'client_portal',
        payload: requestPayload,
        // Prisma-owned table: quoted camelCase columns (lib/users/access-requests.ts).
        // The old created_at / updated_at made this fallback fail every time.
        createdAt: now,
        updatedAt: now,
      })

      if (fbError) {
        // R-053: no silent success — without the request nobody approves the
        // user. The profile exists; a repeated call retries the request.
        return dbError('client/register:request', fbError, 'Не удалось создать заявку на регистрацию. Попробуйте ещё раз.')
      }
      requestId = fallbackId
      requestCreated = true
    }
    } // end if — skip approval request in OPEN mode / when it already exists

    // A repeated call (the request or the company was already there) does not
    // announce the sign-up again.
    const repeated = alreadyApproved ? companyExisted : !requestCreated
    if (!repeated) {
      void runInBackground('client-register:notify', () =>
        notifyAdmins('user_registered', {
          name: displayName,
          email,
          role: 'client',
          organization: company || null,
          status: alreadyApproved ? 'approved' : 'pending_approval',
          requestId,
        }, userId),
      )
    }

    return NextResponse.json(
      { ok: true, requestId, ...(repeated ? { existing: true } : {}) },
      { status: repeated ? 200 : 201 },
    )
  } catch (error) {
    console.error('[client/register] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * The id of the user's registration request, or null. Prisma first (JSON path
 * on payload.userId), then the service role; when neither can answer the
 * lookup is skipped (null) — a duplicate request is better than none.
 */
async function findRegistrationRequest(userId: string): Promise<string | null> {
  try {
    const found = await prisma.adminRequest.findFirst({
      where: { type: 'registration', payload: { path: ['userId'], equals: userId } },
      select: { id: true },
    })
    return found?.id ?? null
  } catch (prismaError) {
    console.warn('[client/register] request lookup via Prisma failed:', prismaError)
  }
  try {
    const { data, error } = await createServiceClient()
      .from('admin_requests')
      .select('id')
      .eq('type', 'registration')
      .eq('payload->>userId', userId)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.id as string | undefined) ?? null
  } catch (lookupError) {
    console.warn('[client/register] request lookup failed:', lookupError)
    return null
  }
}
