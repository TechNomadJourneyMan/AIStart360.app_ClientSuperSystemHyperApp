export interface ContextItem {
  id: string
  organization_id: string
  name: string
}

export interface SalesOrganization {
  id: string
  name: string
  currency: string
  role: string
  permissions: string[]
  regionIds: string[] | null
  channelIds: string[] | null
}

export interface SalesMonitoringContext {
  actor: { id: string; email?: string; profileRole: string }
  organizations: SalesOrganization[]
  regions: ContextItem[]
  channels: ContextItem[]
  categories: ContextItem[]
  costCenters: ContextItem[]
}

export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.error ?? 'Ошибка запроса'
    throw new Error(typeof message === 'string' ? message : 'Ошибка запроса')
  }
  return body.data as T
}

export function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

export function money(value: string | number, currency = 'KZT') {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function monthStart() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

export const fieldClass =
  'w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50'

export const labelClass =
  'mb-2 block text-xs font-medium uppercase tracking-wider text-on-surface-variant'
