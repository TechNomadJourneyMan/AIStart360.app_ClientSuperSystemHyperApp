'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeSync, type RealtimeSyncBinding } from './useRealtimeSync'

export type PointAValueStatus =
  | 'detected'
  | 'needs_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'superseded'
  | 'retracted'

export type PointAResolutionStatus =
  | 'resolved'
  | 'conflict'
  | 'needs_confirmation'
  | 'empty'

export interface CanonicalPointASource {
  id: string
  source_type: 'survey' | 'manual' | 'document' | 'computed' | 'external'
  source_name: string | null
  native_source_id: string | null
  metadata: Record<string, unknown> | null
}

export interface CanonicalPointAValue {
  id: string
  field_key: string
  raw_value: unknown
  normalized_value: unknown
  value_type: 'number' | 'text' | 'boolean' | 'date' | 'list' | 'object'
  unit: string | null
  currency: string | null
  period_key: string
  period_start: string | null
  period_end: string | null
  period_year: number | null
  period_quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  period_month: number | null
  scenario: 'fact' | 'plan' | 'forecast'
  extraction_kind: string
  source_fragment: string | null
  confidence: number | string | null
  status: PointAValueStatus
  updated_at: string
  point_a_sources?: CanonicalPointASource | null
}

export interface CanonicalPointAField {
  id?: string
  resolutionId?: string
  conflictId?: string
  fieldKey: string
  periodKey?: string
  scenario?: 'fact' | 'plan' | 'forecast'
  label: string
  section: string
  selected: CanonicalPointAValue | null
  candidates: CanonicalPointAValue[]
  resolutionStatus: PointAResolutionStatus
  updatedAt: string | null
}

export interface CanonicalPointAModel {
  companyId: string
  generatedAt: string
  completion: number
  fields: CanonicalPointAField[]
  conflicts: CanonicalPointAField[]
  missing: Array<{ fieldKey: string; label: string; section: string }>
  recentChanges: Array<{
    id: string
    fieldKey: string
    eventType: string
    createdAt: string
  }>
}

export interface ManualPointAContext {
  unit?: string | null
  currency?: string | null
  period?: string | null
  periodYear?: number | null
  periodQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  periodMonth?: number | null
  scenario?: 'fact' | 'plan' | 'forecast'
}

interface ModelEnvelope {
  model?: CanonicalPointAModel
  data?: CanonicalPointAModel | { model?: CanonicalPointAModel }
  error?: string
}

function extractModel(payload: ModelEnvelope): CanonicalPointAModel | null {
  if (payload.model) return payload.model
  if (payload.data && 'fields' in payload.data) return payload.data
  if (payload.data && 'model' in payload.data) return payload.data.model ?? null
  return null
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null
  return payload?.error ?? payload?.message ?? `Ошибка запроса (${response.status})`
}

export function useCanonicalPointA() {
  const [model, setModel] = useState<CanonicalPointAModel | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/v1/point-a/model', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await readError(response))
      const payload = await response.json() as ModelEnvelope
      const nextModel = extractModel(payload)
      if (!nextModel) throw new Error('Сервис вернул неполную модель Точки А')
      setModel(nextModel)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить Точку А')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const scheduleRealtimeRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      void refresh()
    }, 250)
  }, [refresh])

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
  }, [])

  const realtimeBindings = useMemo<RealtimeSyncBinding[]>(() => {
    if (!model?.companyId) return []
    const filter = { column: 'company_id', value: model.companyId }
    const invalidateKeys = [['metrics'], ['metrics-catalog']]
    return [
      {
        table: 'point_a_sources',
        filter,
        invalidateKeys,
        onChange: scheduleRealtimeRefresh,
      },
      {
        table: 'point_a_values',
        filter,
        invalidateKeys,
        onChange: scheduleRealtimeRefresh,
      },
      {
        table: 'point_a_resolutions',
        filter,
        invalidateKeys,
        onChange: scheduleRealtimeRefresh,
      },
    ]
  }, [model?.companyId, scheduleRealtimeRefresh])

  useRealtimeSync(realtimeBindings)

  const runAction = useCallback(async (
    actionKey: string,
    url: string,
    method: 'POST' | 'PUT',
    body?: Record<string, unknown>,
  ) => {
    setPendingAction(actionKey)
    setError(null)
    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) throw new Error(await readError(response))
      await refresh()
      return true
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить изменение')
      return false
    } finally {
      setPendingAction(null)
    }
  }, [refresh])

  const setManualValue = useCallback((
    fieldKey: string,
    value: string,
    context: ManualPointAContext = {},
  ) => (
    runAction(
      `manual:${fieldKey}`,
      `/api/v1/point-a/fields/${encodeURIComponent(fieldKey)}`,
      'PUT',
      { value, ...context },
    )
  ), [runAction])

  const confirmValue = useCallback((valueId: string) => (
    runAction(
      `confirm:${valueId}`,
      `/api/v1/point-a/values/${encodeURIComponent(valueId)}/confirm`,
      'POST',
    )
  ), [runAction])

  const resolveConflict = useCallback((conflictId: string, valueId: string) => (
    runAction(
      `resolve:${conflictId}`,
      `/api/v1/point-a/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      'POST',
      { valueId },
    )
  ), [runAction])

  return {
    model,
    isLoading,
    error,
    pendingAction,
    refresh,
    setManualValue,
    confirmValue,
    resolveConflict,
  }
}
