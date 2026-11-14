'use client'

import { useQuery } from '@tanstack/react-query'
import type { Period } from '@/types/periods'
import type { TimeseriesPoint, ForecastPoint, MetricGoal, AnomalyPoint } from '@/types/metrics'

async function fetchTimeseries(id: string, period: Period) {
  const res = await fetch(`/api/v1/metrics/${id}/timeseries?period=${period}`)
  if (!res.ok) throw new Error('Failed to fetch timeseries')
  const json = await res.json()
  return json as { metricId: string; period: Period; granularity: string; unit: string; data: TimeseriesPoint[] }
}

async function fetchForecast(id: string, period: Period) {
  const res = await fetch(`/api/v1/metrics/${id}/forecast?period=${period}`)
  if (!res.ok) throw new Error('Failed to fetch forecast')
  const json = await res.json()
  return json as ForecastResponse
}

/**
 * R-040: `status` / `reason` say why there is no forecast (fewer than 6 business periods, or only edits of the
 * value); `confidence` comes from the fit, null without a forecast.
 */
export interface ForecastResponse {
  data: ForecastPoint[]
  status?: 'ok' | 'insufficient_data' | 'not_business_periods'
  reason?: string | null
  n?: number
  confidence: number | null
  method: string
}

/** The note the metric window shows in place of the forecast; null when there is a forecast (or no answer yet). */
export function forecastUnavailableNote(f: Pick<ForecastResponse, 'status' | 'reason'> | null | undefined): string | null {
  if (!f || !f.status || f.status === 'ok') return null
  if (f.status === 'insufficient_data') return 'Мало данных для прогноза (нужно 6 периодов)'
  return f.reason || 'Прогноз строится только по бизнес-периодам (месяц, квартал, год)'
}

async function fetchGoal(id: string) {
  const res = await fetch(`/api/v1/metrics/${id}/goals`)
  if (!res.ok) throw new Error('Failed to fetch goal')
  const json = await res.json()
  return json.data as MetricGoal | null
}

async function fetchAnomalies(id: string) {
  const res = await fetch(`/api/v1/metrics/${id}/anomalies`)
  if (!res.ok) return []
  const json = await res.json()
  return json.data as AnomalyPoint[]
}

export function useTimeseries(id: string | null, period: Period) {
  return useQuery({
    queryKey: ['timeseries', id, period],
    queryFn: () => fetchTimeseries(id!, period),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}

export function useForecast(id: string | null, period: Period) {
  return useQuery({
    queryKey: ['forecast', id, period],
    queryFn: () => fetchForecast(id!, period),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}

export function useMetricGoal(id: string | null) {
  return useQuery({
    queryKey: ['metric-goal', id],
    queryFn: () => fetchGoal(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}

export function useAnomalies(id: string | null) {
  return useQuery({
    queryKey: ['anomalies', id],
    queryFn: () => fetchAnomalies(id!),
    enabled: !!id,
    staleTime: 10 * 60_000,
  })
}
