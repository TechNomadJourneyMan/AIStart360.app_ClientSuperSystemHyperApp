import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { MetricGoal } from '@/types/metrics'

const MOCK_GOALS: Record<string, MetricGoal> = {
  revenue:   { goalId: 'g-rev',    metricId: 'revenue',   targetValue: 100,  targetUnit: '₸М',  deadline: null, progress: 84,  trajectory: 'on_track' },
  margin:    { goalId: 'g-mar',    metricId: 'margin',    targetValue: 40,   targetUnit: '%',   deadline: null, progress: 86,  trajectory: 'on_track' },
  clients:   { goalId: 'g-cli',    metricId: 'clients',   targetValue: 100,  targetUnit: '',    deadline: null, progress: 48,  trajectory: 'at_risk' },
  avg_check: { goalId: 'g-avg',    metricId: 'avg_check', targetValue: 2,    targetUnit: '₸М',  deadline: null, progress: 88,  trajectory: 'on_track' },
  expenses:  { goalId: 'g-exp',    metricId: 'expenses',  targetValue: 50,   targetUnit: '₸М',  deadline: null, progress: 60,  trajectory: 'behind' },
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const goal = MOCK_GOALS[id] ?? null

  return NextResponse.json({ data: goal })
}
