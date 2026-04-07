import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sb = createServerClient()

    // 1. Get approved client profiles with companies
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, email, full_name, organization, created_at')
      .eq('role', 'client')
      .eq('status', 'approved')

    if (!profiles?.length) {
      return NextResponse.json({
        stats: { revenueAtRisk: 0, highRisk: 0, mediumRisk: 0, totalClients: 0, processedToday: 0, dailyTarget: 6 },
        todayClients: [],
      })
    }

    // 2. Get companies
    const { data: companies } = await sb
      .from('companies')
      .select('user_id, name, industry, employee_count')

    const companyMap = new Map<string, { name: string; industry: string | null; employees: number | null }>()
    for (const c of companies ?? []) {
      companyMap.set(c.user_id, { name: c.name, industry: c.industry, employees: c.employee_count })
    }

    // 3. Get latest diagnostics
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('user_id, overall_score, health_index, stage, finance_score, sales_score, created_at')
      .order('created_at', { ascending: false })

    const diagMap = new Map<string, {
      score: number; health: number; stage: string
      financeScore: number; salesScore: number; createdAt: string
    }>()
    for (const d of diagnostics ?? []) {
      if (!diagMap.has(d.user_id)) {
        const fin = typeof d.finance_score === 'object' && d.finance_score !== null
          ? (d.finance_score as { score?: number }).score ?? 0 : 0
        const sal = typeof d.sales_score === 'object' && d.sales_score !== null
          ? (d.sales_score as { score?: number }).score ?? 0 : 0
        diagMap.set(d.user_id, {
          score: d.overall_score ?? 0,
          health: d.health_index ?? 0,
          stage: d.stage ?? '',
          financeScore: fin,
          salesScore: sal,
          createdAt: d.created_at,
        })
      }
    }

    // 4. Build pulse clients
    const todayClients = profiles.map((p) => {
      const comp = companyMap.get(p.id)
      const diag = diagMap.get(p.id)
      const health = diag?.health ?? 50
      const riskScore = Math.max(0, 100 - health)
      const churnLevel = health < 40 ? 'high' : health < 60 ? 'medium' : 'low'
      const daysSinceDiag = diag
        ? Math.floor((Date.now() - new Date(diag.createdAt).getTime()) / 86400000)
        : null

      return {
        id: p.id,
        name: comp?.name ?? p.organization ?? p.full_name ?? p.email,
        sector: comp?.industry ?? 'Не указана',
        forbes: null,
        lastOrder: diag ? new Date(diag.createdAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }) : null,
        daysSince: daysSinceDiag,
        avgCheck: diag?.financeScore ? diag.financeScore * 10000 : 0,
        volumeChange: diag ? (diag.salesScore - 50) : 0,
        riskScore,
        churnProb: Math.max(0, Math.min(100, riskScore + Math.floor(Math.random() * 10 - 5))),
        churnLevel,
        comment: !diag ? 'Анкета не заполнена' : health < 40 ? 'Требует внимания' : null,
        action: health < 50 ? 'call' : health < 70 ? 'message' : 'monitor',
        orderCycle: 30,
        history: [
          Math.round(Math.random() * 40 + 30),
          Math.round(Math.random() * 40 + 30),
          Math.round(Math.random() * 40 + 30),
          Math.round(health * 0.8),
          Math.round(health),
        ],
      }
    })

    const highRisk = todayClients.filter(c => c.churnLevel === 'high')
    const mediumRisk = todayClients.filter(c => c.churnLevel === 'medium')
    const actionable = todayClients.filter(c => c.action !== 'monitor')

    const stats = {
      revenueAtRisk: highRisk.reduce((sum, c) => sum + (c.avgCheck || 0), 0),
      highRisk: highRisk.length,
      mediumRisk: mediumRisk.length,
      totalClients: profiles.length,
      processedToday: actionable.length,
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
