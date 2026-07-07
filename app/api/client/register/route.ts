export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * POST /api/client/register
 * Called after Supabase Auth signup succeeds.
 * Creates:
 *   1. A row in public.profiles (safety net — trigger may have already created it)
 *   2. A row in public.companies
 *   3. An AdminRequest record via Prisma (so GIGA-panel sees the request)
 *      Falls back to direct Supabase insert if Prisma fails.
 *
 * Body: { userId, email, name, company }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, email, name, company } = (await req.json()) as {
      userId: string
      email: string
      name: string
      company: string
    }

    if (!userId || !email) {
      return NextResponse.json({ error: 'userId and email are required' }, { status: 400 })
    }

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
    if (authUser.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (await isRateLimitedKey(authUser.id, 'client-register', { max: 5, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // 1. Ensure profile exists (trigger on auth.users INSERT may have created
    //    it). Do NOT set status here — the handle_new_user trigger / column
    //    default own the initial value, and OPEN registration mode may have
    //    already approved this user; forcing pending_approval would downgrade it.
    await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: name || email,
        role: 'client',
      },
      { onConflict: 'id' }
    )

    // If the user is already approved (OPEN registration mode) there is no
    // approval request to create.
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle()
    const alreadyApproved = prof?.status === 'approved'

    // 2. Create company record
    if (company) {
      await supabaseAdmin.from('companies').insert({
        user_id: userId,
        name: company,
      })
    }

    // 3. Create AdminRequest — try Prisma first, fallback to direct Supabase
    //    insert. Skipped entirely in OPEN mode (nothing to approve).
    let requestId: string | null = null

    if (!alreadyApproved) {
    const requestPayload = {
      userId,
      email,
      name: name || email,
      company: company || '',
      subject: `Регистрация: ${name || email}`,
      description: `Новая заявка на регистрацию от ${name || email}${company ? ` (${company})` : ''}`,
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
    } catch (prismaError) {
      console.warn('[client/register] Prisma failed, falling back to Supabase insert:', prismaError)

      // Fallback: insert directly into admin_requests table via Supabase
      // (same physical PostgreSQL database, bypasses Prisma connection issues)
      const fallbackId = crypto.randomUUID()
      const now = new Date().toISOString()

      const { error: fbError } = await supabaseAdmin.from('admin_requests').insert({
        id: fallbackId,
        type: 'registration',
        status: 'new',
        priority: 'medium',
        source: 'client_portal',
        payload: requestPayload,
        created_at: now,
        updated_at: now,
      })

      if (fbError) {
        console.error('[client/register] Supabase fallback also failed:', fbError)
        // Still return success — the user's Supabase profile exists,
        // reconciliation in Giga Panel will catch the orphan later
      } else {
        requestId = fallbackId
      }
    }
    } // end if (!alreadyApproved) — skip approval request in OPEN mode

    return NextResponse.json({ ok: true, requestId }, { status: 201 })
  } catch (error) {
    console.error('[client/register] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
