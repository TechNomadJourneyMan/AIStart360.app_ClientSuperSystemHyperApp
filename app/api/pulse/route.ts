import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. Fetch metrics summary
    const clients = await prisma.client.findMany({
      include: { pulseMetrics: true }
    })

    const highRiskClients = clients.filter(c => c.pulseMetrics?.churnLevel === 'high')
    const mediumRiskClients = clients.filter(c => c.pulseMetrics?.churnLevel === 'medium')
    
    // 2. Format Today's Clients
    const todayClients = clients
      .filter(c => c.pulseMetrics?.action !== 'monitor')
      .map(c => ({
        id: c.id,
        name: c.name,
        sector: c.sector,
        forbes: c.forbesRank,
        lastOrder: c.pulseMetrics?.lastOrder?.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }),
        daysSince: c.pulseMetrics?.daysSince,
        avgCheck: c.pulseMetrics?.avgCheck,
        volumeChange: c.pulseMetrics?.volumeChange,
        riskScore: c.pulseMetrics?.riskScore,
        churnProb: c.pulseMetrics?.churnProb,
        churnLevel: c.pulseMetrics?.churnLevel,
        comment: c.pulseMetrics?.comment,
        action: c.pulseMetrics?.action,
        orderCycle: c.orderCycle,
        history: c.pulseMetrics?.history as number[],
      }))

    // Calculate Stats from real actionable rows.
    const stats = {
      revenueAtRisk: highRiskClients.reduce((sum, c) => sum + (c.pulseMetrics?.avgCheck || 0), 0),
      highRisk: highRiskClients.length,
      mediumRisk: mediumRiskClients.length,
      totalClients: clients.length,
      processedToday: todayClients.length,
      dailyTarget: 6,
    }

    return NextResponse.json({ stats, todayClients })
  } catch (error) {
    console.error('Pulse API Error:', error)
    // Return empty data so the UI renders without crashing
    return NextResponse.json({
      stats: { revenueAtRisk: 0, highRisk: 0, mediumRisk: 0, totalClients: 0, processedToday: 0, dailyTarget: 6 },
      todayClients: [],
    })
  }
}
