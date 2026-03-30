import { useQuery } from '@tanstack/react-query'

export interface PulseMetric {
  id: string
  clientId: string
  lastOrder: string | Date
  daysSince: number
  avgCheck: number
  volumeChange: number
  riskScore: number
  churnProb: number
  churnLevel: 'high' | 'medium' | 'low'
  comment: string
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
      return res.json() as Promise<{ stats: any, todayClients: any[] }>
    },
  })
}
