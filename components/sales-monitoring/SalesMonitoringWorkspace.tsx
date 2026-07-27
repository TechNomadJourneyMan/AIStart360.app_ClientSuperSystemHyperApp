'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SalePanel, type SaleListItem } from './SalePanel'
import { OperationsPanel } from './OperationsPanel'
import {
  apiRequest,
  fieldClass,
  labelClass,
  money,
  monthStart,
  today,
  type SalesMonitoringContext,
} from './client'
import type { DashboardSnapshot } from '@/types/sales-monitoring'

type Tab = 'overview' | 'sales' | 'expenses' | 'plans' | 'import' | 'assistant'

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'overview', label: 'Обзор', icon: 'space_dashboard' },
  { id: 'sales', label: 'Продажи', icon: 'point_of_sale' },
  { id: 'expenses', label: 'Расходы', icon: 'payments' },
  { id: 'plans', label: 'Планы', icon: 'track_changes' },
  { id: 'import', label: 'Импорт', icon: 'upload_file' },
  { id: 'assistant', label: 'AI-аналитик', icon: 'auto_awesome' },
]

function completion(actual: string, plan: string) {
  const target = Number(plan)
  return target > 0 ? Math.round((Number(actual) / target) * 100) : 0
}

export function SalesMonitoringWorkspace() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [organizationId, setOrganizationId] = useState('')
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [regionId, setRegionId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'fallback'>('connecting')

  const contextQuery = useQuery({
    queryKey: ['sales-monitoring-context'],
    queryFn: () => apiRequest<SalesMonitoringContext>('/api/v1/sales-monitoring/context'),
    staleTime: 60_000,
  })
  const context = contextQuery.data

  useEffect(() => {
    if (!organizationId && context?.organizations[0]) {
      setOrganizationId(context.organizations[0].id)
    }
  }, [context, organizationId])

  useEffect(() => {
    setRegionId('')
    setChannelId('')
  }, [organizationId])

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams({ organizationId, from, to })
    if (regionId) params.set('regionId', regionId)
    if (channelId) params.set('channelId', channelId)
    return params.toString()
  }, [organizationId, from, to, regionId, channelId])

  const dashboardQuery = useQuery({
    queryKey: ['sales-dashboard', organizationId, from, to, regionId, channelId],
    queryFn: () => apiRequest<DashboardSnapshot>(`/api/v1/sales-analytics/dashboard?${querySuffix}`),
    enabled: Boolean(organizationId),
    refetchInterval: liveState === 'live' ? false : 30_000,
  })
  const salesQuery = useQuery({
    queryKey: ['sales-list', organizationId, from, to],
    queryFn: () => apiRequest<SaleListItem[]>(
      `/api/v1/sales?${new URLSearchParams({ organizationId, from, to, limit: '100' })}`,
    ),
    enabled: Boolean(organizationId),
    refetchInterval: liveState === 'live' ? false : 30_000,
  })

  useEffect(() => {
    if (!organizationId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`sales-monitoring:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'analytics_update_signals',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['sales-dashboard', organizationId] })
          queryClient.invalidateQueries({ queryKey: ['sales-list', organizationId] })
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveState('live')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLiveState('fallback')
      })
    const fallback = window.setTimeout(() => {
      setLiveState((current) => current === 'connecting' ? 'fallback' : current)
    }, 8_000)
    return () => {
      window.clearTimeout(fallback)
      void supabase.removeChannel(channel)
    }
  }, [organizationId, queryClient])

  const organization = context?.organizations.find((item) => item.id === organizationId)
  const regions = context?.regions.filter((item) => item.organization_id === organizationId) ?? []
  const channels = context?.channels.filter((item) => item.organization_id === organizationId) ?? []
  const kpis = dashboardQuery.data?.kpis
  const refresh = () => {
    void dashboardQuery.refetch()
    void salesQuery.refetch()
  }

  if (contextQuery.isLoading) {
    return <Card className="min-h-64 animate-pulse" />
  }

  if (contextQuery.error) {
    return (
      <Card className="border border-error/20">
        <p className="font-semibold text-error">Модуль не удалось открыть</p>
        <p className="mt-2 text-sm text-on-surface-variant">
          {contextQuery.error.message}. Проверьте применение миграции 003 и подключение базы.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => contextQuery.refetch()}>
          Повторить
        </Button>
      </Card>
    )
  }

  if (!context?.organizations.length) {
    return (
      <Card className="border border-tertiary-container/20">
        <h1 className="font-headline text-2xl font-bold">Мониторинг продаж</h1>
        <p className="mt-3 text-on-surface-variant">
          У пользователя нет доступной организации. Администратору нужно назначить роль и область
          доступа в <code className="text-primary">user_role_assignments</code>.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-5 pb-24 lg:pb-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined">monitoring</span>
            </div>
            <div>
              <h1 className="font-headline text-2xl font-bold md:text-3xl">Эффективность продаж</h1>
              <p className="text-sm text-on-surface-variant">
                Единый журнал операций, P&amp;L, ДДС и план-факт
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className={labelClass}>Организация</span>
            <select
              className={`${fieldClass} min-w-56`}
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {context.organizations.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="mb-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <span className={liveState === 'live' ? 'status-dot-online' : 'status-dot-warning'} />
            {liveState === 'live' ? 'Обновления онлайн' : 'Резерв: каждые 30 сек.'}
          </div>
          <Button variant="secondary" size="sm" leftIcon="sync" onClick={refresh}>
            Синхронизировать
          </Button>
        </div>
      </div>

      <Card padding="sm" className="flex flex-wrap items-end gap-3">
        <label>
          <span className={labelClass}>С</span>
          <input className={fieldClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className={labelClass}>По</span>
          <input className={fieldClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          <span className={labelClass}>Регион</span>
          <select className={`${fieldClass} min-w-44`} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">Все регионы</option>
            {regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span className={labelClass}>Канал</span>
          <select className={`${fieldClass} min-w-44`} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Все каналы</option>
            {channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span className="ml-auto pb-2 text-xs text-on-surface-variant">
          Роль: {organization?.role}
        </span>
      </Card>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-container-low p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex min-w-max items-center gap-2 rounded-lg px-4 py-2.5 text-sm transition ${
              tab === item.id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-white/[0.03]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Выручка', money(kpis?.revenue ?? 0, organization?.currency), 'payments'],
              ['Валовая прибыль', money(kpis?.grossProfit ?? 0, organization?.currency), 'trending_up'],
              ['Маржинальность', `${kpis?.grossMarginPct ?? '0.00'}%`, 'percent'],
              ['Операционная прибыль', money(kpis?.operatingProfit ?? 0, organization?.currency), 'account_balance'],
            ].map(([label, value, icon]) => (
              <Card key={label} className="border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant">{label}</span>
                  <span className="material-symbols-outlined text-primary/70">{icon}</span>
                </div>
                <p className="mt-3 font-headline text-2xl font-bold">{dashboardQuery.isLoading ? '…' : value}</p>
              </Card>
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[1fr_1.5fr]">
            <Card>
              <h2 className="font-headline text-lg font-bold">План-факт</h2>
              <div className="mt-5 space-y-5">
                {[
                  ['Выручка', kpis?.revenue ?? '0', kpis?.planRevenue ?? '0'],
                  ['Валовая прибыль', kpis?.grossProfit ?? '0', kpis?.planGrossProfit ?? '0'],
                ].map(([label, actual, plan]) => {
                  const pct = completion(actual, plan)
                  return (
                    <div key={label}>
                      <div className="mb-2 flex justify-between text-sm">
                        <span>{label}</span><span>{pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-on-surface-variant">
                        {money(actual, organization?.currency)} из {money(plan, organization?.currency)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </Card>
            <RecentSales sales={salesQuery.data ?? []} currency={organization?.currency ?? 'KZT'} />
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <SalePanel
          organization={organization!}
          regions={regions}
          channels={channels}
          sales={salesQuery.data ?? []}
          loading={salesQuery.isLoading}
          onChanged={refresh}
        />
      )}
      {tab !== 'overview' && tab !== 'sales' && (
        <OperationsPanel
          tab={tab}
          organization={organization!}
          context={context}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function RecentSales({ sales, currency }: { sales: SaleListItem[]; currency: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-lg font-bold">Последние продажи</h2>
        <span className="text-xs text-on-surface-variant">{sales.length} операций</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-on-surface-variant">
            <tr><th className="py-2">Номер</th><th>Дата</th><th>Статус</th><th className="text-right">Выручка</th></tr>
          </thead>
          <tbody>
            {sales.slice(0, 8).map((sale) => (
              <tr key={sale.id} className="border-t border-white/[0.05]">
                <td className="py-3 font-mono text-xs">{sale.number}</td>
                <td>{new Date(sale.soldAt).toLocaleDateString('ru-KZ')}</td>
                <td><Status status={sale.status} /></td>
                <td className="text-right">{money(sale.revenueTotal, currency)}</td>
              </tr>
            ))}
            {!sales.length && <tr><td colSpan={4} className="py-10 text-center text-on-surface-variant">Продаж за период нет</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    draft: 'Черновик', posted: 'Проведена', reversed: 'Сторнирована',
    pending_approval: 'На согласовании', waiting_for_product: 'Ожидает товара',
  }
  return (
    <span className="rounded-full border border-outline-variant/30 px-2 py-1 text-xs">
      {labels[status] ?? status}
    </span>
  )
}
