import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AnomalyPoint } from '@/types/metrics'
import type { Period } from '@/types/periods'

const MOCK_ANOMALIES: Record<string, AnomalyPoint[]> = {
  revenue: [
    {
      timestamp: new Date(Date.now() - 15 * 24 * 3600_000).toISOString(),
      label: '18 мар',
      value: 77.4,
      severity: 'warning',
      description: 'Замедление роста — выручка ниже тренда на 8.3%. Возможен разовый отток клиента.',
    },
  ],
  churn: [
    {
      timestamp: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(),
      label: '25 мар',
      value: 7.1,
      severity: 'critical',
      description: 'Резкий рост оттока +69% — требует немедленного анализа когорты.',
    },
  ],
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const anomalies: AnomalyPoint[] = MOCK_ANOMALIES[id] ?? []
  return NextResponse.json({ data: anomalies })
}
