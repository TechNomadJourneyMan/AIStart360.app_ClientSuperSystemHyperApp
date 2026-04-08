import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { calculatePointA } from '@/lib/point-a-engine'
import { calculatePointB } from '@/lib/point-b-engine'
import { analyzePointB } from '@/lib/ai/point-b-analyzer'

/**
 * GET /api/clients/:id/analysis/point-b
 * Calculates the target state state for a specific client based on their onboarding data.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const { error, user } = await requireAuth()
    if (error) return error

    // 1. Fetch Client & Onboarding Data
    const client = await prisma.client.findUnique({
      where: { id: params.id },
      include: {
        onboarding: true,
        griReports: {
          orderBy: { calculatedAt: 'desc' },
          take: 1
        }
      }
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    if (!client.onboarding) {
      return NextResponse.json({ error: 'Onboarding data not found' }, { status: 400 })
    }

    const answers = (client.onboarding.answers as any) || {}

    // 2. Calculate Point A (Baseline for Point B)
    const pointA = calculatePointA(answers)

    // 3. Calculate Point B (Base logic)
    const pointBBase = calculatePointB(answers, pointA)

    // 4. Enhance with AI if needed (Optional)
    const aiBridge = await analyzePointB(answers, pointA, pointBBase, client)

    const pointB = {
      ...pointBBase,
      ...aiBridge, // Merge AI insights if available
    }

    return NextResponse.json(pointB)

  } catch (error: any) {
    console.error('[point-b-api] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
