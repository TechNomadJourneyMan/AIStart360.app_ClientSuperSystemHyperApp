export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const FEATURE_LABELS: Record<string, string> = {
  '/metrics': 'Метрики',
  '/market': 'Рынок',
  '/point-b': 'Точка Б',
}

/**
 * POST /api/v1/upgrade-request
 * Records a Pro upgrade request from the authenticated client.
 * Body: { featureKey: string }. The user id comes from the session, not the
 * body, so requests can't be spoofed for another user. See technical-audit A5.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    const body = await req.json()
    const { featureKey } = body as { featureKey?: string }

    if (!featureKey) {
      return NextResponse.json({ ok: false, error: 'featureKey required' }, { status: 400 })
    }

    const featureLabel = FEATURE_LABELS[featureKey] ?? featureKey
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!

    // Fetch user profile info
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=full_name,email`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
    )
    const profiles = await profileRes.json() as Array<{ full_name: string | null; email: string | null }>
    const profile = profiles[0]
    const userName = profile?.full_name || profile?.email || 'Неизвестный'
    const userEmail = profile?.email || '—'

    const payload = {
      userId,
      featureKey,
      name: userName,
      email: userEmail,
      subject: `Pro тариф: ${featureLabel}`,
      description: `Пользователь ${userName} (${userEmail}) запросил доступ к разделу "${featureLabel}" в рамках Pro тарифа.`,
    }

    // Try Prisma first
    try {
      const { prisma } = await import('@/lib/db')
      await prisma.adminRequest.create({
        data: {
          type: 'access',
          status: 'new',
          priority: 'medium',
          source: 'upgrade_modal',
          payload,
        },
      })
      return NextResponse.json({ ok: true })
    } catch {
      // Prisma unavailable — fall through to Supabase
    }

    // Supabase fallback
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/admin_requests`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        type: 'access',
        status: 'new',
        priority: 'medium',
        source: 'upgrade_modal',
        payload,
      }),
    })

    if (!insertRes.ok) {
      const err = await insertRes.text()
      console.error('[upgrade-request] Supabase insert failed:', err)
      return NextResponse.json({ ok: false, error: 'Failed to create request' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[upgrade-request] POST error:', error)
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }
}
