export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'
import { runSimulation, type SimInput } from '@/lib/simulator/core'

/**
 * GET  /api/v1/simulator            → { ok, simulations }
 * POST /api/v1/simulator {input, title?} → { ok, id, result }
 *
 * Business simulator (K). The deterministic core computes the projection;
 * results are persisted to business_simulations (migration 052, self-only RLS).
 * A projection is never a fact — the result carries assumptions + confidence.
 */
const MAX_PER_USER = 20

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('business_simulations')
    .select('id, sim_type, title, status, result, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true, simulations: data ?? [] })
}

const inputSchema = z.object({
  simType: z.enum(['revenue_growth', 'cost_reduction', 'anti_crisis']),
  currentRevenueMonthly: z.number().nonnegative(),
  marginPct: z.number().min(0).max(100),
  horizonMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  targetRevenueMonthly: z.number().nonnegative().nullable().optional(),
  monthlyCostsFixed: z.number().nonnegative().optional(),
  costCutPct: z.number().min(0).max(100).optional(),
})
const bodySchema = z.object({ input: inputSchema, title: z.string().max(120).optional() })

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'simulator-run', { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  // Cap saved simulations per user.
  const { count } = await sb.from('business_simulations').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if ((count ?? 0) >= MAX_PER_USER) {
    return NextResponse.json({ ok: false, error: `Достигнут лимит сохранённых симуляций (${MAX_PER_USER}).` }, { status: 409 })
  }

  const result = runSimulation(parsed.data.input as SimInput)

  const { data, error } = await sb
    .from('business_simulations')
    .insert({
      user_id: user.id,
      sim_type: parsed.data.input.simType,
      status: 'completed',
      title: parsed.data.title ?? null,
      inputs: parsed.data.input,
      result,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id, result })
}
