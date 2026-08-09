'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface IntegrationStatus {
  enabled: boolean
  provider?: 'myhonor'
  company?: string
  store_url?: string
  state?:
    | 'live'
    | 'catalog_connected'
    | 'catalog_syncing'
    | 'catalog_sync_failed'
    | 'awaiting_first_sync'
    | 'configuration_required'
    | 'migration_required'
  catalog?: {
    count: number
    synced_at: string | null
    complete?: boolean
    sweep?: {
      id: string
      status: 'in_progress' | 'completed' | 'failed' | 'superseded'
      seen_count: number
      expected_count: number
      failure_code: string | null
    } | null
  }
  orders?: { count: number; synced_at: string | null }
  privacy?: {
    customer_identity: 'pseudonymous'
    raw_email_stored: false
    raw_phone_stored: false
  }
}

const STATE_COPY: Record<
  NonNullable<IntegrationStatus['state']>,
  { label: string; detail: string; tone: string }
> = {
  live: {
    label: 'Live',
    detail: 'Каталог подключён, подписанные обезличенные заказы приняты',
    tone: 'text-primary border-primary/30 bg-primary/10',
  },
  catalog_connected: {
    label: 'Каталог подключён',
    detail: 'Заказы появятся после первого подписанного события',
    tone: 'text-amber-300 border-amber-300/30 bg-amber-300/10',
  },
  catalog_syncing: {
    label: 'Синхронизация',
    detail: 'Загружаем полный каталог и проверяем его целостность',
    tone: 'text-sky-300 border-sky-300/30 bg-sky-300/10',
  },
  catalog_sync_failed: {
    label: 'Нужен повтор',
    detail: 'Последний полный импорт не прошёл проверку целостности',
    tone: 'text-error border-error/30 bg-error/10',
  },
  awaiting_first_sync: {
    label: 'Готово к синхронизации',
    detail: 'Коннектор настроен и ожидает первый импорт',
    tone: 'text-sky-300 border-sky-300/30 bg-sky-300/10',
  },
  configuration_required: {
    label: 'Нужна привязка',
    detail: 'Подключите защищённую привязку магазина к этому аккаунту',
    tone: 'text-amber-300 border-amber-300/30 bg-amber-300/10',
  },
  migration_required: {
    label: 'Настройка',
    detail: 'Подготавливаем защищённое хранилище интеграции',
    tone: 'text-on-surface-variant border-white/10 bg-white/[0.03]',
  },
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return 'ещё не было'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'время неизвестно'
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(timestamp).toLocaleDateString('ru-RU')
}

export default function MyHonorIntegrationStatus() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/integrations/myhonor/status', {
        credentials: 'include',
        cache: 'no-store',
      })
      const body = await response.json() as {
        ok?: boolean
        data?: IntegrationStatus
      }
      setStatus(response.ok && body.ok ? body.data ?? null : null)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const syncCatalog = useCallback(async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      let sweepId: string | null = null
      let previousOffset = -1
      for (let page = 0; page < 25; page += 1) {
        const params = new URLSearchParams({ limit: '24' })
        if (sweepId) params.set('sweep_id', sweepId)
        const response = await fetch(
          `/api/v1/integrations/myhonor/catalog/import?${params}`,
          { method: 'POST', credentials: 'include', cache: 'no-store' },
        )
        const body = await response.json() as {
          ok?: boolean
          data?: {
            persistence?: {
              sweepId?: string
              sweepStatus?: 'in_progress' | 'completed' | 'failed' | 'superseded'
              nextOffset?: number | null
              catalogComplete?: boolean
              failureCode?: string | null
            }
          }
          error?: { message?: string }
        }
        if (!response.ok || !body.ok || !body.data?.persistence) {
          throw new Error(body.error?.message ?? 'Catalog sync failed')
        }
        const persistence = body.data.persistence
        sweepId = persistence.sweepId ?? sweepId
        if (persistence.catalogComplete) {
          await load()
          return
        }
        if (
          !sweepId
          || persistence.sweepStatus !== 'in_progress'
          || persistence.nextOffset === null
          || persistence.nextOffset === undefined
          || persistence.nextOffset <= previousOffset
        ) {
          throw new Error('Catalog sweep is incomplete')
        }
        previousOffset = persistence.nextOffset
      }
      throw new Error('Catalog sweep exceeded its safety page limit')
    } catch {
      setSyncError('Не удалось завершить синхронизацию. Повторите позже.')
      await load()
    } finally {
      setSyncing(false)
    }
  }, [load])

  if (loading || !status?.enabled || !status.state) return null

  const state = STATE_COPY[status.state]
  return (
    <section
      aria-label="Интеграция интернет-магазина MyHonor"
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-surface-container-low to-surface-container-low p-5"
    >
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary">
              Client integration
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${state.tone}`}>
              {state.label}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <span className="material-symbols-outlined text-primary">storefront</span>
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-headline text-lg font-bold text-on-surface">
                {status.company ?? 'HONOR GROUP'} × AIStart360
              </h2>
              <p className="text-xs text-on-surface-variant">{state.detail}</p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:min-w-[440px]">
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <dt className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
              Каталог
            </dt>
            <dd className="mt-1 font-mono text-lg font-bold text-on-surface">
              {status.catalog?.count ?? 0}
            </dd>
            <p className="text-[10px] text-on-surface-variant">
              {relativeTime(status.catalog?.synced_at)}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <dt className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
              Заказы
            </dt>
            <dd className="mt-1 font-mono text-lg font-bold text-on-surface">
              {status.orders?.count ?? 0}
            </dd>
            <p className="text-[10px] text-on-surface-variant">
              {relativeTime(status.orders?.synced_at)}
            </p>
          </div>
          <div className="col-span-2 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5 sm:col-span-1">
            <dt className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
              Privacy
            </dt>
            <dd className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
              <span className="material-symbols-outlined text-sm">verified_user</span>
              Без PII
            </dd>
            <p className="text-[10px] text-on-surface-variant">customer hash</p>
          </div>
        </dl>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void syncCatalog()}
            disabled={
              syncing
              || status.state === 'migration_required'
              || status.state === 'configuration_required'
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-mono text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-sm ${syncing ? 'animate-spin' : ''}`}>
              {syncing ? 'progress_activity' : 'sync'}
            </span>
            {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </button>
          <a
            href={status.store_url ?? 'https://myhonor.shop'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-mono text-on-surface-variant transition-colors hover:border-primary/30 hover:text-primary"
          >
            Магазин
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </a>
          <Link
            href="/journey"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-on-primary transition-transform hover:scale-[0.99]"
          >
            Открыть Journey
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Обновить статус интеграции"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-on-surface-variant hover:border-primary/30 hover:text-primary"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
          </button>
          {syncError && (
            <p className="basis-full text-[10px] text-error">{syncError}</p>
          )}
        </div>
      </div>
    </section>
  )
}
