export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'

/**
 * POST /api/client/register
 * Called after Supabase Auth signup succeeds.
 * Creates:
 *   1. A row in public.profiles (safety net — trigger may have already created it)
 *   2. A row in public.companies
 *   3. An AdminRequest record via Prisma (so GIGA-panel sees the request)
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

    // 1. Ensure profile exists (trigger on auth.users INSERT may have created it)
    await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: name || email,
        role: 'client',
        status: 'pending_approval',
      },
      { onConflict: 'id' }
    )

    // 2. Create company record
    if (company) {
      await supabaseAdmin.from('companies').insert({
        user_id: userId,
        name: company,
      })
    }

    // 3. Create AdminRequest in Prisma so GIGA-panel shows it
    const adminRequest = await prisma.adminRequest.create({
      data: {
        type: 'registration',
        status: 'new',
        priority: 'medium',
        source: 'client_portal',
        payload: {
          userId,
          email,
          name: name || email,
          company: company || '',
          subject: `Регистрация: ${name || email}`,
          description: `Новая заявка на регистрацию от ${name || email}${company ? ` (${company})` : ''}`,
        },
      },
    })

    return NextResponse.json({ ok: true, requestId: adminRequest.id }, { status: 201 })
  } catch (error) {
    console.error('[client/register] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
