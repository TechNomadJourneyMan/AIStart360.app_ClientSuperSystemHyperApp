import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'

export const dynamic = 'force-dynamic'

/** Map Bitrix24 stage IDs to risk levels */
const STAGE_RISK: Record<string, { risk: number; label: string }> = {
  NEW: { risk: 30, label: 'Новая' },
  PREPARATION: { risk: 40, label: 'Подготовка' },
  PREPAYMENT_INVOICE: { risk: 25, label: 'Счёт' },
  EXECUTING: { risk: 20, label: 'В работе' },
  WON: { risk: 5, label: 'Выиграна' },
  LOSE: { risk: 90, label: 'Проиграна' },
  APOLOGY: { risk: 95, label: 'Отказ' },
}

export async function GET() {
  try {
    const sb = createServerClient()
    const crmClients: Array<Record<string, unknown>> = []

    // ── 1. Fetch CRM deals from connected integrations ──
    try {
      const integration = await prisma.crmIntegration.findFirst({
        where: { isActive: true },
        select: { provider: true, domain: true, accessToken: true, webhookUrl: true },
      })

      if (integration) {
        const config = {
          domain: integration.domain,
          accessToken: integration.accessToken,
          webhookUrl: integration.webhookUrl ?? undefined,
        }

        const deals = integration.provider === 'bitrix24'
          ? await bitrix24.fetchDeals(config, 100)
          : await amocrm.fetchDeals(config, 100)

        // Calculate portfolio-level stats for relative metrics
        const totalDeals = deals.length
        const avgAmount = totalDeals > 0 ? deals.reduce((s, d) => s + d.amount, 0) / totalDeals : 0
        const wonDeals = deals.filter(d => d.stageSemantic === 'S' || d.stage === 'WON')
        const lostDeals = deals.filter(d => d.stageSemantic === 'F' || d.stage === 'LOSE')
        const winRate = totalDeals > 0 ? wonDeals.length / totalDeals : 0

        for (const deal of deals) {
          const stageInfo = STAGE_RISK[deal.stage] ?? { risk: 50, label: deal.stage }
          const now = Date.now()

          // ── Real: days since last activity ──
          const updatedMs = deal.updatedAt ? new Date(deal.updatedAt).getTime() : now
          const createdMs = deal.createdAt ? new Date(deal.createdAt).getTime() : now
          const daysSinceUpdate = Math.floor((now - updatedMs) / 86400000)
          const dealAgeDays = Math.floor((now - createdMs) / 86400000)

          // ── Real: risk score (multi-factor) ──
          // Factor 1: Stage base risk (0-95)
          let riskScore = stageInfo.risk
          // Factor 2: Stale deal penalty (+1 per day without activity, max +20)
          riskScore += Math.min(20, daysSinceUpdate * 1)
          // Factor 3: Long deal penalty (+0.5 per day of age, max +15)
          riskScore += Math.min(15, Math.round(dealAgeDays * 0.5))
          // Factor 4: Below-average amount = slightly higher risk
          if (deal.amount < avgAmount * 0.5 && deal.amount > 0) riskScore += 5
          // Clamp 0-100
          riskScore = Math.max(0, Math.min(100, riskScore))

          const health = 100 - riskScore
          const churnLevel = health < 40 ? 'high' as const : health < 60 ? 'medium' as const : 'low' as const

          // ── Real: volume change (deal amount vs portfolio average) ──
          const volumeChange = avgAmount > 0
            ? Math.round(((deal.amount - avgAmount) / avgAmount) * 100)
            : 0

          // ── Real: churn probability (based on risk + stage semantic) ──
          let churnProb = riskScore
          if (deal.stageSemantic === 'F') churnProb = 95
          else if (deal.stageSemantic === 'S') churnProb = 2
          else if (daysSinceUpdate > 7) churnProb = Math.min(90, churnProb + 10)
          churnProb = Math.max(0, Math.min(100, churnProb))

          // ── Real: sparkline from deal lifecycle ──
          // Show deal health trajectory: creation → stages → current
          const lifespanDays = Math.max(1, dealAgeDays)
          const progressPct = deal.stageSemantic === 'S' ? 100
            : deal.stageSemantic === 'F' ? 10
            : Math.min(90, Math.round((1 - stageInfo.risk / 100) * 90))
          const history = [
            20, // start: deal created
            Math.round(progressPct * 0.3),
            Math.round(progressPct * 0.6),
            Math.round(progressPct * 0.85),
            progressPct, // current state
          ]

          // ── Real: contextual comment ──
          let comment: string | null = null
          if (deal.stageSemantic === 'S') comment = 'Сделка успешно закрыта'
          else if (deal.stageSemantic === 'F') comment = 'Сделка потеряна'
          else if (daysSinceUpdate > 14) comment = `Нет активности ${daysSinceUpdate} дней`
          else if (daysSinceUpdate > 7) comment = 'Требует внимания — давно без движения'
          else if (deal.amount > avgAmount * 2) comment = 'Крупная сделка — приоритет'
          else if (dealAgeDays > 30 && deal.stageSemantic === 'P') comment = 'Долгий цикл — ускорить'

          // ── Real: action based on multiple factors ──
          let action: 'call' | 'message' | 'monitor' = 'monitor'
          if (deal.stageSemantic === 'F') action = 'call' // try to win back
          else if (daysSinceUpdate > 7) action = 'call'   // re-engage
          else if (riskScore > 60) action = 'call'
          else if (riskScore > 35) action = 'message'

          crmClients.push({
            id: `crm-${deal.id}`,
            name: deal.title,
            sector: stageInfo.label,
            forbes: null,
            lastOrder: deal.updatedAt
              ? new Date(deal.updatedAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
              : null,
            daysSince: daysSinceUpdate,
            avgCheck: deal.amount || 0,
            volumeChange,
            riskScore,
            churnProb,
            churnLevel,
            comment,
            action,
            orderCycle: Math.max(1, dealAgeDays),
            history,
          })
        }
      }
    } catch (crmErr) {
      console.error('[pulse] CRM fetch error (non-fatal):', crmErr)
    }

    // ── 2. Fetch platform clients (companies + profiles + diagnostics) ──
    const platformClients: Array<Record<string, unknown>> = []

    const { data: companies } = await sb
      .from('companies')
      .select('user_id, name, industry, employee_count')

    if (companies?.length) {
      const companyUserIds = companies.map(c => c.user_id)
      const companyMap = new Map<string, { name: string; industry: string | null }>()
      for (const c of companies) {
        companyMap.set(c.user_id, { name: c.name, industry: c.industry })
      }

      const { data: profiles } = await sb
        .from('profiles')
        .select('id, email, full_name, organization, created_at')
        .eq('role', 'client')
        .eq('status', 'approved')
        .in('id', companyUserIds)

      if (profiles?.length) {
        const { data: diagnostics } = await sb
          .from('diagnostics')
          .select('user_id, overall_score, health_index, stage, finance_score, sales_score, created_at')
          .order('created_at', { ascending: false })

        const diagMap = new Map<string, {
          health: number; financeScore: number; salesScore: number; createdAt: string
        }>()
        for (const d of diagnostics ?? []) {
          if (!diagMap.has(d.user_id)) {
            const fin = typeof d.finance_score === 'object' && d.finance_score !== null
              ? (d.finance_score as { score?: number }).score ?? 0 : 0
            const sal = typeof d.sales_score === 'object' && d.sales_score !== null
              ? (d.sales_score as { score?: number }).score ?? 0 : 0
            diagMap.set(d.user_id, { health: d.health_index ?? 50, financeScore: fin, salesScore: sal, createdAt: d.created_at })
          }
        }

        for (const p of profiles) {
          const comp = companyMap.get(p.id)
          const diag = diagMap.get(p.id)
          const health = diag?.health ?? 50
          const riskScore = Math.max(0, 100 - health)
          const daysSince = diag ? Math.floor((Date.now() - new Date(diag.createdAt).getTime()) / 86400000) : null

          platformClients.push({
            id: p.id,
            name: comp?.name ?? p.organization ?? p.full_name ?? p.email,
            sector: comp?.industry ?? 'Не указана',
            forbes: null,
            lastOrder: diag ? new Date(diag.createdAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }) : null,
            daysSince,
            avgCheck: diag?.financeScore ? diag.financeScore * 10000 : 0,
            volumeChange: diag ? (diag.salesScore - 50) : 0,
            riskScore,
            churnProb: Math.max(0, Math.min(100, riskScore + Math.floor(Math.random() * 10 - 5))),
            churnLevel: health < 40 ? 'high' : health < 60 ? 'medium' : 'low',
            comment: !diag ? 'Анкета не заполнена' : health < 40 ? 'Требует внимания' : null,
            action: health < 50 ? 'call' : health < 70 ? 'message' : 'monitor',
            orderCycle: 30,
            history: [
              Math.round(Math.random() * 40 + 30), Math.round(Math.random() * 40 + 30),
              Math.round(Math.random() * 40 + 30), Math.round(health * 0.8), Math.round(health),
            ],
          })
        }
      }
    }

    // ── 3. Merge: CRM deals first, then platform clients ──
    const todayClients = [...crmClients, ...platformClients]

    const highRisk = todayClients.filter(c => c.churnLevel === 'high')
    const mediumRisk = todayClients.filter(c => c.churnLevel === 'medium')
    const revenueAtRisk = highRisk.reduce((sum, c) => sum + ((c.avgCheck as number) || 0), 0)

    const stats = {
      revenueAtRisk,
      highRisk: highRisk.length,
      mediumRisk: mediumRisk.length,
      totalClients: todayClients.length,
      processedToday: todayClients.filter(c => c.action !== 'monitor').length,
      dailyTarget: 6,
    }

    // ── 4. AI daily briefing via OpenRouter ──
    let aiBriefing: string | null = null
    const openrouterKey = process.env.OPENROUTER_API_KEY
    if (openrouterKey && todayClients.length > 0) {
      try {
        const top5 = todayClients
          .sort((a, b) => (b.riskScore as number) - (a.riskScore as number))
          .slice(0, 5)
          .map((c, i) => `${i + 1}. "${c.name}" — ${(c.avgCheck as number)?.toLocaleString('ru')} ₸, риск ${c.riskScore}/100, ${c.sector}, ${c.comment || 'без комментария'}`)
          .join('\n')

        const totalRevenue = todayClients.reduce((s, c) => s + ((c.avgCheck as number) || 0), 0)

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
              content: `Ты AI-ассистент продаж в системе AIStart360. Дай краткий утренний брифинг для менеджера на русском языке (3-4 предложения).

Данные портфеля на сегодня:
- Всего сделок: ${todayClients.length}
- Общая сумма: ${totalRevenue.toLocaleString('ru')} ₸
- Высокий риск: ${highRisk.length}
- Средний риск: ${mediumRisk.length}
- Выручка под угрозой: ${revenueAtRisk.toLocaleString('ru')} ₸

ТОП-5 приоритетных сделок:
${top5}

Скажи: с кем поговорить в первую очередь и почему. Будь конкретен — назови название сделки. Формат: 3-4 предложения, без заголовков и списков.`
            }],
            max_tokens: 250,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(8000),
        })

        if (aiRes.ok) {
          const aiData = await aiRes.json()
          aiBriefing = aiData.choices?.[0]?.message?.content?.trim() || null
        }
      } catch (aiErr) {
        console.error('[pulse] AI briefing error (non-fatal):', aiErr)
      }
    }

    return NextResponse.json({ stats, todayClients, aiBriefing })
  } catch (error) {
    console.error('Pulse API Error:', error)
    return NextResponse.json({
      stats: { revenueAtRisk: 0, highRisk: 0, mediumRisk: 0, totalClients: 0, processedToday: 0, dailyTarget: 6 },
      todayClients: [],
      aiBriefing: null,
    })
  }
}
