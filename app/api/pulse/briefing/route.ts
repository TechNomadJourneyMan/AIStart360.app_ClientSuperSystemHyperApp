export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'

const STAGE_RISK: Record<string, number> = {
  NEW: 30, PREPARATION: 40, PREPAYMENT_INVOICE: 25,
  EXECUTING: 20, WON: 5, LOSE: 90, APOLOGY: 95,
}

/**
 * POST /api/pulse/briefing — generate or refresh daily sales briefing
 * Caches in setting 'pulse_briefing' for 1 day
 */
export async function POST() {
  try {
    const openrouterKey = process.env.OPENROUTER_API_KEY
    if (!openrouterKey) {
      return NextResponse.json({ briefing: null, error: 'OpenRouter not configured' })
    }

    // Fetch deals from CRM
    const integration = await prisma.crmIntegration.findFirst({
      where: { isActive: true },
      select: { provider: true, domain: true, accessToken: true, webhookUrl: true },
    })

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
      return NextResponse.json({ briefing: 'Нет active сделок в CRM.' })
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
      `${i + 1}. "${d.title}" — ${d.amount.toLocaleString("en")} ₸, risk ${d.risk}/100, inactive for ${d.daysSince} days`
    ).join('\n')

    const totalRevenue = deals.reduce((s, d) => s + d.amount, 0)
    const highRisk = ranked.filter(d => d.risk >= 60).length
    const lostRevenue = ranked.filter(d => d.risk >= 60).reduce((s, d) => s + d.amount, 0)

    // Call OpenRouter
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aistart360.vercel.app',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{
          role: 'user',
          content: `Ты бизнес-ассистент in the system AIStart360. Дай краткий утренний брифинг для менеджера по продажам на русском языке (3-4 предложения).

Портфель на сегодня:
- Total сделок: ${deals.length}
- Общая сумма: ${totalRevenue.toLocaleString("en")} ₸
- Высокий risk: ${highRisk}
- Выручка под угрозой: ${lostRevenue.toLocaleString("en")} ₸

ТОП-5 приоритетных:
${top5}

Скажи конкретно: с кем поговорить в первую очередь и почему. Назови названия сделок. Формат: 3-4 предложения, без заголовков и списков.`
        }],
        max_tokens: 250,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      return NextResponse.json({ briefing: null, error: `OpenRouter ${aiRes.status}: ${errText.slice(0, 100)}` })
    }

    const aiData = await aiRes.json()
    const briefing = aiData.choices?.[0]?.message?.content?.trim() || null

    return NextResponse.json({ briefing })
  } catch (error) {
    console.error('[pulse/briefing] Error:', error)
    return NextResponse.json({ briefing: null, error: 'Failed to generate briefing' })
  }
}
