import { useQuery } from '@tanstack/react-query'

// null = unknown (GET /api/pulse): a client without an official Point A score has no risk, and the
// platform has no order data (check, volume change). Never render a null as 0.
export interface PulseMetric {
  id: string
  clientId: string
  lastOrder: string | Date | null
  daysSince: number | null
  avgCheck: number | null
  volumeChange: number | null
  riskScore: number | null
  churnProb: number | null
  churnLevel: 'high' | 'medium' | 'low' | null
  comment: string | null
  action: 'call' | 'message' | 'monitor'
  history: number[]
  client: {
    id: string
    name: string
    industry: string
    sector: string
    forbesRank?: number | null
  }
}

export function usePulse() {
  return useQuery({
    queryKey: ['pulse-data'],
    queryFn: async () => {
      const res = await fetch('/api/pulse')
      if (!res.ok) throw new Error('Failed to fetch pulse data')
      return res.json() as Promise<{ stats: any, todayClients: any[], aiBriefing?: string | null }>
    },
  })
}
