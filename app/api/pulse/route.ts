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

        for (const deal of deals) {
          const stageInfo = STAGE_RISK[deal.stage] ?? { risk: 50, label: deal.stage }
          const riskScore = stageInfo.risk
          const health = 100 - riskScore
          const churnLevel = health < 40 ? 'high' as const : health < 60 ? 'medium' as const : 'low' as const
          const daysSince = deal.updatedAt
            ? Math.floor((Date.now() - new Date(deal.updatedAt).getTime()) / 86400000)
            : null

          crmClients.push({
            id: `crm-${deal.id}`,
            name: deal.title,
            sector: stageInfo.label,
            forbes: null,
            lastOrder: deal.updatedAt
              ? new Date(deal.updatedAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
              : null,
            daysSince,
            avgCheck: deal.amount || 0,
            volumeChange: deal.stage === 'WON' ? 15 : deal.stage === 'LOSE' ? -30 : 0,
            riskScore,
            churnProb: Math.max(0, Math.min(100, riskScore + Math.floor(Math.random() * 10 - 5))),
            churnLevel,
            comment: deal.stage === 'WON' ? 'Сделка закрыта' : deal.stage === 'LOSE' ? 'Клиент потерян' : null,
            action: health < 50 ? 'call' : health < 70 ? 'message' : 'monitor',
            orderCycle: daysSince ?? 30,
            history: [
              Math.round(Math.random() * 40 + 30),
              Math.round(Math.random() * 40 + 30),
              Math.round(Math.random() * 40 + 30),
              Math.round(health * 0.8),
              Math.round(health),
            ],
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

    return NextResponse.json({ stats, todayClients })
  } catch (error) {
    console.error('Pulse API Error:', error)
    return NextResponse.json({
      stats: { revenueAtRisk: 0, highRisk: 0, mediumRisk: 0, totalClients: 0, processedToday: 0, dailyTarget: 6 },
      todayClients: [],
    })
  }
}
