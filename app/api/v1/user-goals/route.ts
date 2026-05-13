export const dynamic = 'force-dynamic'

/**
 * GET / POST /api/v1/user-goals
 *
 * Stores three revenue figures per user (monthly KZT):
 *   - current_revenue_monthly_kzt
 *   - goal_1y_monthly_kzt
 *   - goal_3y_monthly_kzt
 *
 * Persisted under profiles.branding JSONB → branding.goals.{...} to
 * avoid a dedicated migration. Server-side uses service-role REST.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

interface GoalsShape {
  current_revenue_monthly_kzt: number | null
  goal_1y_monthly_kzt: number | null
  goal_3y_monthly_kzt: number | null
  updated_at: string | null
}

const EMPTY: GoalsShape = {
  current_revenue_monthly_kzt: null,
  goal_1y_monthly_kzt: null,
  goal_3y_monthly_kzt: null,
  updated_at: null,
}

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function readBranding(userId: string): Promise<Record<string, unknown> | null> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=branding`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as Array<{ branding: Record<string, unknown> | null }>
  return rows[0]?.branding ?? {}
}

async function writeBranding(userId: string, branding: Record<string, unknown>): Promise<boolean> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ branding }),
  })
  return res.ok
}

function extractGoals(branding: Record<string, unknown> | null): GoalsShape {
  if (!branding) return EMPTY
  const g = (branding as { goals?: Partial<GoalsShape> }).goals
  if (!g) return EMPTY
  return {
    current_revenue_monthly_kzt: typeof g.current_revenue_monthly_kzt === 'number' ? g.current_revenue_monthly_kzt : null,
    goal_1y_monthly_kzt: typeof g.goal_1y_monthly_kzt === 'number' ? g.goal_1y_monthly_kzt : null,
    goal_3y_monthly_kzt: typeof g.goal_3y_monthly_kzt === 'number' ? g.goal_3y_monthly_kzt : null,
    updated_at: typeof g.updated_at === 'string' ? g.updated_at : null,
  }
}

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

  const branding = await readBranding(user.id)
  return NextResponse.json({ ok: true, goals: extractGoals(branding) })
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

  let body: Partial<GoalsShape>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }

  const sanitize = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const newGoals: GoalsShape = {
    current_revenue_monthly_kzt: sanitize(body.current_revenue_monthly_kzt),
    goal_1y_monthly_kzt: sanitize(body.goal_1y_monthly_kzt),
    goal_3y_monthly_kzt: sanitize(body.goal_3y_monthly_kzt),
    updated_at: new Date().toISOString(),
  }

  const existingBranding = (await readBranding(user.id)) ?? {}
  const merged = { ...existingBranding, goals: newGoals }
  const ok = await writeBranding(user.id, merged)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, goals: newGoals })
}
