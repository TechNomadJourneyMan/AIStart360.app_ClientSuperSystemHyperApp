export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { getDailyBriefing } from '@/lib/pulse/briefing'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'

const STAGE_RISK: Record<string, number> = {
  NEW: 30, PREPARATION: 40, PREPAYMENT_INVOICE: 25,
  EXECUTING: 20, WON: 5, LOSE: 90, APOLOGY: 95,
}

// Staff roles that may see the platform CRM briefing (Pulse is not for clients).
const PULSE_ROLES = new Set(['super_admin', 'admin', 'expert', 'manager'])

/**
 * POST /api/pulse/briefing — daily sales briefing from the connected CRM.
 * Generation goes through lib/pulse/briefing.ts: shared OpenRouter client,
 * validator, per-user day cache (ai_briefing_cache) and 10/hour limit.
 */
export async function POST() {
  try {
    // Auth: staff session required. Prevents anonymous callers from burning the
    // OpenRouter budget and reading platform CRM data.
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: profile } = await sb
      .from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = typeof profile?.role === 'string' ? profile.role : 'client'
    if (!PULSE_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!hasOpenRouterKey()) {
      return NextResponse.json({ briefing: null, error: 'OpenRouter not configured' })
    }

    // Фаза 4B — фикс МЕЖАРЕНДНОЙ УТЕЧКИ: было prisma.crmIntegration.findFirst({
    // isActive: true }) БЕЗ скоупа → чужая CRM в брифинге. Legacy Prisma-стек
    // мёртв; путь отключён (integration=null) — брифинг честно вернёт «No CRM».
    const integration = null as {
      provider: string
      domain: string
      accessToken: string
      webhookUrl: string | null
    } | null

    if (!integration) {
      return NextResponse.json({ briefing: null, error: 'No CRM connected' })
    }

    const config = {
      domain: integration.domain,
      accessToken: integration.accessToken,
      webhookUrl: integration.webhookUrl ?? undefined,
    }

    const deals = integration.provider === 'bitrix24'
      ? await bitrix24.fetchDeals(config, 100)
      : await amocrm.fetchDeals(config, 100)

    if (deals.length === 0) {
      return NextResponse.json({ briefing: 'Нет активных сделок в CRM.' })
    }

    // Calculate stats
    const avgAmount = deals.reduce((s, d) => s + d.amount, 0) / deals.length
    const now = Date.now()

    const ranked = deals.map(d => {
      const stageRisk = STAGE_RISK[d.stage] ?? 50
      const daysSince = d.updatedAt ? Math.floor((now - new Date(d.updatedAt).getTime()) / 86400000) : 0
      const risk = Math.min(100, stageRisk + Math.min(20, daysSince) + (d.amount < avgAmount * 0.5 ? 5 : 0))
      return { ...d, risk, daysSince }
    }).sort((a, b) => b.risk - a.risk)

    const top5 = ranked.slice(0, 5).map((d, i) =>
      `${i + 1}. "${d.title}" — ${d.amount.toLocaleString('ru')} ₸, риск ${d.risk}/100, без активности ${d.daysSince} дн.`
    ).join('\n')

    const totalRevenue = deals.reduce((s, d) => s + d.amount, 0)
    const highRisk = ranked.filter(d => d.risk >= 60).length
    const lostRevenue = ranked.filter(d => d.risk >= 60).reduce((s, d) => s + d.amount, 0)

    const prompt = `Ты бизнес-ассистент в системе AIStart360. Дай краткий утренний брифинг для менеджера по продажам на русском языке (3-4 предложения).

Портфель на сегодня:
- Всего сделок: ${deals.length}
- Общая сумма: ${totalRevenue.toLocaleString('ru')} ₸
- Высокий риск: ${highRisk}
- Выручка под угрозой: ${lostRevenue.toLocaleString('ru')} ₸

ТОП-5 приоритетных:
${top5}

Скажи конкретно: с кем поговорить в первую очередь и почему. Назови названия сделок. Опирайся только на эти данные. Формат: 3-4 предложения, без заголовков и списков.`

    const result = await getDailyBriefing(user.id, prompt)
    if (result.limited) {
      return NextResponse.json({ briefing: null, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
    }
    const briefing = result.text

    return NextResponse.json({ briefing, cached: result.cached, validation: result.validation })
  } catch (error) {
    console.error('[pulse/briefing] Error:', error)
    return NextResponse.json({ briefing: null, error: 'Failed to generate briefing' })
  }
}
