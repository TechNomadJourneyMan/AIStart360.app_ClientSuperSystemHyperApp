const MONTHLY_REVENUE_KEYS = ['monthly_revenue', 'revenue_monthly', 'revenue'] as const

type UnknownRecord = Record<string, unknown>

export interface GrowthSnapshotValues {
  currentMonthly: number | null
  runRate12: number | null
  progressToPlan: number | null
  progressTo12: number | null
  progressTo3y: number | null
  gap12: number | null
  gap3y: number | null
}

export function annualRevenueTargetToMonthly(target: number | null): number | null {
  return target !== null && Number.isFinite(target) && target >= 0
    ? Math.round(target / 12)
    : null
}

export async function patchDashboardResource(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as UnknownRecord | null
  if (!response.ok || payload?.ok !== true) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Не удалось сохранить данные (${response.status}).`
    throw new Error(message)
  }
  return payload
}

/**
 * Accepts both the current metrics envelope (`{ data: MetricSummary[] }`) and
 * the former `{ data: { items } }` shape. Only named revenue metrics with a
 * finite, non-negative value can become a dashboard KPI.
 */
export function extractMonthlyRevenue(payload: unknown): number | null {
  const root = asRecord(payload)
  const data = root ? root.data : undefined
  const dataRecord = asRecord(data)
  const items = Array.isArray(data)
    ? data
    : Array.isArray(dataRecord?.items)
      ? dataRecord.items
      : []

  for (const key of MONTHLY_REVENUE_KEYS) {
    const item = items
      .map(asRecord)
      .find((candidate) => candidate?.id === key)
    const value = finiteNumber(item?.rawValue) ?? finiteNumber(item?.value)
    if (value !== null && value >= 0) return value
  }
  return null
}

/**
 * Derives comparisons only from an attributable current-month value. Targets
 * alone are never used to manufacture a "current" result.
 */
export function deriveGrowthSnapshotValues(
  liveMonthlyRevenue: number | null,
  monthlyPlan12: number | null,
  monthlyPlan3y: number | null,
): GrowthSnapshotValues {
  const currentMonthly =
    liveMonthlyRevenue !== null &&
    Number.isFinite(liveMonthlyRevenue) &&
    liveMonthlyRevenue >= 0
      ? Math.round(liveMonthlyRevenue)
      : null
  const runRate12 = currentMonthly === null ? null : currentMonthly * 12

  return {
    currentMonthly,
    runRate12,
    progressToPlan: progress(currentMonthly, monthlyPlan12),
    progressTo12: progress(currentMonthly, monthlyPlan12),
    progressTo3y: progress(currentMonthly, monthlyPlan3y),
    gap12: difference(currentMonthly, monthlyPlan12),
    gap3y: difference(currentMonthly, monthlyPlan3y),
  }
}

function progress(value: number | null, target: number | null): number | null {
  if (value === null || target === null || target <= 0 || !Number.isFinite(target)) return null
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)))
}

function difference(value: number | null, target: number | null): number | null {
  if (value === null || target === null || !Number.isFinite(target)) return null
  return value - target
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
