'use client'

import { useState, useEffect, useCallback } from 'react'

interface ServiceResult {
  name: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
}

function statusDot(status: ServiceResult['status']) {
  if (status === 'online')   return 'bg-primary'
  if (status === 'degraded') return 'bg-yellow-400'
  return 'bg-red-500'
}

function latencyColor(ms: number) {
  if (ms > 300) return 'text-red-400'
  if (ms > 150) return 'text-yellow-400'
  return 'text-on-surface-variant/40'
}

export function SystemHealthCompact() {
  const [services, setServices] = useState<ServiceResult[]>([])
  const [allOnline, setAllOnline] = useState(true)

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setAllOnline(data.allOnline ?? true)
        setServices(data.services ?? [])
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, 30_000)
    return () => clearInterval(id)
  }, [fetchHealth])

  // Only show when all services are healthy — avoids scaring users on login
  if (!allOnline || services.length === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-6 pt-5 border-t border-white/[0.04]">
      {services.map((svc) => (
        <div key={svc.name} className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(svc.status)}`} />
          <span className="text-[10px] font-mono text-on-surface-variant/50">{svc.name}</span>
          <span className={`text-[10px] font-mono ${latencyColor(svc.latencyMs)}`}>
            {svc.latencyMs}ms
          </span>
        </div>
      ))}
    </div>
  )
}
