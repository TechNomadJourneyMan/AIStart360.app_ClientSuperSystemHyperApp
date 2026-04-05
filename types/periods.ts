// ============================================================
// Period system — single source of truth for FE + BE
// ============================================================

export const PERIODS = ['1W', '1M', '3M', '1Y', '3Y'] as const
export type Period = typeof PERIODS[number]

export type Granularity = 'day' | 'week' | 'month' | 'quarter'

export interface PeriodConfig {
  label: string       // API param value
  labelRu: string     // UI display
  granularity: Granularity
  defaultPoints: number
  showForecast: boolean
}

export const PERIOD_CONFIG: Record<Period, PeriodConfig> = {
  '1W': { label: '1W', labelRu: '7Д',  granularity: 'day',     defaultPoints: 7,  showForecast: false },
  '1M': { label: '1M', labelRu: '30Д', granularity: 'day',     defaultPoints: 30, showForecast: false },
  '3M': { label: '3M', labelRu: '3М',  granularity: 'week',    defaultPoints: 13, showForecast: true  },
  '1Y': { label: '1Y', labelRu: '1Г',  granularity: 'month',   defaultPoints: 12, showForecast: true  },
  '3Y': { label: '3Y', labelRu: '3Г',  granularity: 'quarter', defaultPoints: 12, showForecast: true  },
}

export const DEFAULT_PERIOD: Period = '1M'
