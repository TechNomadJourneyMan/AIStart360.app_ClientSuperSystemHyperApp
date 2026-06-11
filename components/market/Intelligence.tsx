'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  TrendingDown,
  Award,
  AlertTriangle,
  Briefcase,
  Activity,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { type IntelligenceAlert } from './mock-data'
import {
  getIntelligenceAlerts,
  getCompetitors,
  statusLineFor,
  type MarketApiError,
  type MarketCompetitor,
} from '@/lib/market-api'

/**
 * Intelligence / Monitoring Radar view — market signal feed.
 *
 * Signals are derived (honestly labelled «Тендер») from GET /tenders/recent via
 * the Mark-analytics proxy (lib/market-api.ts). No fabricated price-drop / legal
 * signals — only real tender records. The "Active Targets" panel lists tracked
 * companies from the directory. When the backend is unconfigured/unavailable the
 * honest empty state is kept with a subtle status line.
 */
export function Intelligence() {
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>([])
  const [competitors, setCompetitors] = useState<MarketCompetitor[]>([])
  const [syncing, setSyncing] = useState(false)
  const [statusLine, setStatusLine] = useState<string | null>(null)

  const trackedCompetitors = competitors.filter((c) => c.isTracked)

  const load = useCallback(async () => {
    setSyncing(true)
    try {
      const [alertsRes, compRes] = await Promise.all([
        getIntelligenceAlerts(),
        getCompetitors({ region: 'Kazakhstan' }),
      ])
      if (alertsRes.ok) {
        setAlerts(alertsRes.data)
        setStatusLine(null)
      } else {
        setAlerts([])
        setStatusLine(statusLineFor(alertsRes.error as MarketApiError))
      }
      setCompetitors(compRes.ok ? compRes.data : [])
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSync = load

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex flex-col gap-2">
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            Monitoring Radar
          </h2>
          <p className="text-on-surface-variant text-sm">
            Active tracking of competitor changes and market signals
          </p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing} className="shrink-0">
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync Signals
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
            Active Targets
          </h3>

          {trackedCompetitors.length === 0 ? (
            <div className="text-sm text-on-surface-variant/70 p-4 border border-dashed border-white/10 rounded-xl">
              Сейчас нет отслеживаемых конкурентов. Перейдите во вкладку «Конкуренты» и включите
              мониторинг для нужной компании.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {trackedCompetitors.map((comp) => (
                <div
                  key={comp.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low border border-white/[0.05]"
                >
                  <div className="relative">
                    <div className="h-10 w-10 rounded-full bg-surface-container flex items-center justify-center border border-white/[0.08] text-xs font-semibold text-on-surface-variant">
                      {comp.name.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-primary border-2 border-surface-container-low animate-pulse" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-on-surface truncate">{comp.name}</p>
                    <p className="text-xs text-on-surface-variant/70 truncate">{comp.category}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <h3 className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
            Intelligence Feed
          </h3>

          {alerts.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-white/10 rounded-2xl bg-surface-container-low/50">
              <Activity className="h-12 w-12 text-on-surface-variant/40 mx-auto mb-4" />
              <h4 className="text-lg font-medium text-on-surface mb-2">Сигналов пока нет</h4>
              <p className="text-on-surface-variant">
                Здесь появятся события по конкурентам, когда источники будут подключены.
              </p>
              {statusLine && (
                <p className="text-xs text-on-surface-variant/60 mt-4">{statusLine}</p>
              )}
            </div>
          ) : (
            <div className="relative border-l border-white/10 ml-4 space-y-6 pb-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="relative pl-6">
                  <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-on-surface-variant/60 ring-4 ring-background" />
                  <AlertCard alert={alert} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface AlertCardProps {
  alert: IntelligenceAlert
}

function AlertCard({ alert }: AlertCardProps) {
  const colors = getColorClass(alert.type)
  return (
    <div className={`bg-surface-container-low rounded-2xl border backdrop-blur-md p-4 flex gap-4 ${colors}`}>
      <div className="mt-1">{getIcon(alert.type)}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-on-surface">{alert.competitorName}</span>
          <span className="text-xs text-on-surface-variant/70">{formatRelative(alert.timestamp)}</span>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-2 text-on-surface-variant">
          {alert.type}
        </div>
        <p className="text-sm text-on-surface-variant">{alert.description}</p>
      </div>
    </div>
  )
}

function getIcon(type: IntelligenceAlert['type']) {
  switch (type) {
    case 'Price Drop':
      return <TrendingDown className="h-4 w-4 text-secondary" />
    case 'Tender Win':
      return <Award className="h-4 w-4 text-primary" />
    case 'Legal Risk':
      return <AlertTriangle className="h-4 w-4 text-error" />
    case 'New Vacancy':
      return <Briefcase className="h-4 w-4 text-tertiary-container" />
    default:
      return <Activity className="h-4 w-4 text-on-surface-variant" />
  }
}

function getColorClass(type: IntelligenceAlert['type']): string {
  switch (type) {
    case 'Price Drop':
      return 'border-secondary/20 bg-secondary/5'
    case 'Tender Win':
      return 'border-primary/20 bg-primary/5'
    case 'Legal Risk':
      return 'border-error/20 bg-error/5'
    case 'New Vacancy':
      return 'border-tertiary-container/20 bg-tertiary-container/5'
    default:
      return 'border-white/[0.05]'
  }
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' })
}
