export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { computeRealityCheck } from '@/lib/gri/reality-check'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * GET /api/v1/gri/reality-check — «GRI Reality Check» (идея №30).
 *
 * Детерминированная сверка САМООЦЕНКИ из GRI-теста (section_avgs текущего
 * gri_assessments) с ФАКТАМИ анкеты и Точки А из того же снимка, что видит
 * ассистент (buildAssistantContext). НИКАКОГО LLM, никакой записи в БД —
 * только чтение под cookie-сессией (IDOR-safe, по образцу next-best-action).
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimited(req, 'gri:reality-check', { max: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  try {
    // Текущий GRI-ассессмент — самооценка по блокам (0–10).
    const { data: assessment } = await sb
      .from('gri_assessments')
      .select('section_avgs')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    const rawAvgs = (assessment as { section_avgs?: unknown } | null)?.section_avgs
    const sectionAvgs: Record<string, number> = {}
    if (rawAvgs && typeof rawAvgs === 'object' && !Array.isArray(rawAvgs)) {
      for (const [k, v] of Object.entries(rawAvgs as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : Number(v)
        if (Number.isFinite(n)) sectionAvgs[k] = n
      }
    }

    // Факты: анкета + Точка А + Точка B — тот же курируемый снимок,
    // что у ассистента (никаких сырых строк БД в правила).
    const ctx = await buildAssistantContext(user.id, sb)

    const items = computeRealityCheck({ sectionAvgs, ctx })

    return NextResponse.json({
      ok: true,
      items,
      hasData: items.length > 0 || !!assessment,
    })
  } catch (error) {
    console.error('[gri/reality-check] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
