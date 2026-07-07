'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  uptime: string
}

interface HealthData {
  services: ServiceResult[]
  allOnline: boolean
  degradedCount: number
  summary: string
  timestamp: string
}

// PERF-06: 30s (was 5s) — each poll runs a server-side DB ping + fetches.
const POLL_INTERVAL_MS = 30_000

function latencyColor(ms: number) {
  if (ms > 300) return 'text-error'
  if (ms > 150) return 'text-tertiary-container'
  return 'text-on-surface-variant/50'
}

function statusDotClass(status: ServiceResult['status']) {
  if (status === 'online')   return 'status-dot-online'
  if (status === 'degraded') return 'status-dot-warning'
  return 'status-dot-error'
}

export function SystemHealth() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const inFlight = useRef(false)

  const fetchHealth = useCallback(async () => {
    // PERF-06: never overlap requests, and don't poll a hidden tab.
    if (inFlight.current) return
    if (typeof document !== 'undefined' && document.hidden) return
    inFlight.current = true
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setLastUpdated(new Date())
      }
    } catch {}
    finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS)
    // Refresh once when the tab becomes visible again (data may be stale).
    const onVisibility = () => { if (!document.hidden) fetchHealth() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchHealth])

  const services = data?.services ?? []
  const allOnline = data?.allOnline ?? true
  const summary = data?.summary ?? 'Проверка...'

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={loading ? 'status-dot-warning' : allOnline ? 'status-dot-online' : 'status-dot-warning'} />
          <span className="text-[11px] font-mono text-primary uppercase tracking-widest">System Status</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-on-surface-variant">{summary}</span>
          {lastUpdated && (
            <span className="text-[10px] font-mono text-on-surface-variant/30">
              обновлено {lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetchHealth}
            className="text-on-surface-variant/30 hover:text-primary transition-colors"
            title="Обновить"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {loading && services.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-8 w-32 rounded-xl" />
            ))
          : services.map((svc) => (
              <div
                key={svc.name}
                className="group relative flex items-center gap-2 bg-surface-container rounded-xl px-3 py-2 border border-white/[0.03] hover:border-white/[0.08] transition-all duration-150 cursor-default"
              >
                <span className={statusDotClass(svc.status)} />
                <span className="text-xs text-on-surface-variant">{svc.name}</span>
                <span className={`text-[10px] font-mono ${latencyColor(svc.latencyMs)}`}>
                  {svc.latencyMs}ms
                </span>

                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-surface-container-highest rounded-xl border border-white/10 text-[10px] font-mono text-on-surface-variant whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-modal">
                  <div className="flex flex-col gap-0.5">
                    <span>Uptime: <span className="text-primary">{svc.uptime}</span></span>
                    <span>Latency: <span className={latencyColor(svc.latencyMs)}>{svc.latencyMs}ms</span></span>
                    <span>Status: <span className={svc.status === 'online' ? 'text-primary' : svc.status === 'degraded' ? 'text-tertiary-container' : 'text-error'}>{svc.status}</span></span>
                  </div>
                </div>
              </div>
            ))
        }
      </div>
    </div>
  )
}
