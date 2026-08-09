export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { getAnalyticsData } from '@/lib/analytics-data'
import { AnalyticsKpiGrid, type KpiFact, type KpiTile } from './AnalyticsKpiGrid'
import { AnalyticsPeriodTabs } from './AnalyticsPeriodTabs'
import { ClientPerformanceTable } from './ClientPerformanceTable'
import { GriTrendChart } from './GriTrendChart'
import { IndustryBreakdown, type IndustryRow } from './IndustryBreakdown'
import { getAnalyticsDetail, getGriReportCounts, getPeriod, parsePeriodId } from './analytics-detail'
import {
  CLIENT_STATUS_LABELS,
  formatAmount,
  formatAmountFull,
  formatDateFull,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
} from './format'

export const metadata: Metadata = { title: 'Аналитика' }

type PageProps = {
  searchParams?: { period?: string | string[] }
}

/** Small link-only empty state so a card never dead-ends. */
function CardEmpty({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-4 text-center border border-dashed border-outline-variant/30 rounded-xl px-6">
      <p className="text-sm text-on-surface-variant max-w-sm">{text}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-xs font-mono text-primary border border-primary/25 rounded-lg px-3 py-2 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          arrow_forward
        </span>
        {action}
      </Link>
    </div>
  )
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const periodId = parsePeriodId(searchParams?.period)
  const period = getPeriod(periodId)

  const [data, detail] = await Promise.all([getAnalyticsData(), getAnalyticsDetail(periodId)])

  // Needed to tell «GRI 0» from «never measured» in the table below.
  const griReportCounts = await getGriReportCounts(data.clientPerformance.map((row) => row.id))

  const statusCount = (status: string) =>
    detail.clients.statusCounts.find((row) => row.status === status)?.count ?? 0
  const atRisk = statusCount('at_risk')
  const inactive = statusCount('inactive')

  const industryTotal = data.industryBreakdown.reduce((sum, item) => sum + item.value, 0)
  const industryRows: IndustryRow[] = data.industryBreakdown.map((item) => ({
    name: item.name,
    value: item.value,
    clients: detail.industryClientCounts.find((row) => row.industry === item.name)?.clients ?? 0,
  }))

  const avgCheckFacts: KpiFact[] = [
    { label: 'Точная сумма', value: formatAmountFull(data.kpis.portfolioGmv) },
    {
      label: 'Клиентов с заполненным чеком',
      value: `${formatNumber(detail.avgCheck.filled)} из ${formatNumber(detail.clients.total)}`,
    },
    {
      label: 'Клиентов без чека',
      value: formatNumber(detail.avgCheck.missing),
      href: detail.avgCheck.missing > 0 ? '/clients' : undefined,
    },
    ...detail.avgCheck.top.map((client) => ({
      label: `Топ: ${client.name}`,
      value: formatAmountFull(client.value),
      href: `/clients/${client.id}`,
    })),
  ]

  const tiles: KpiTile[] = [
    {
      id: 'gri',
      label: 'Средний GRI',
      value: formatScore(detail.gri.avgDisplay),
      scope: `за ${period.label}, шкала 0–1000`,
      delta:
        detail.gri.deltaPercent === null
          ? null
          : { percent: detail.gri.deltaPercent, text: 'к прошлому такому же периоду' },
      definition:
        'Среднее по всем GRI-отчётам, рассчитанным за выбранный период. В базе балл хранится в шкале 0–100, на экранах портала показывается умноженным на 10.',
      facts: [
        { label: 'Отчётов за период', value: formatNumber(detail.gri.reportCount) },
        { label: 'Отчётов за прошлый период', value: formatNumber(detail.gri.previousReportCount) },
        {
          label: 'Средний GRI прошлого периода',
          value: formatScore(detail.gri.previousAvgDisplay),
        },
        { label: 'Минимум за период', value: formatScore(detail.gri.minDisplay) },
        { label: 'Максимум за период', value: formatScore(detail.gri.maxDisplay) },
        { label: 'Клиентов с GRI-отчётом', value: formatNumber(detail.gri.clientsWithGri) },
        {
          label: 'Последний расчёт',
          value: detail.gri.lastReportAt ? formatDateFull(detail.gri.lastReportAt) : '—',
        },
      ],
      missing:
        detail.gri.avgDisplay === null
          ? `За ${period.genitive} не рассчитан ни один GRI-отчёт, поэтому среднего нет. Выберите период шире или запустите диагностику.`
          : undefined,
      links: [{ label: 'GRI-диагностика', href: '/gri' }],
    },
    {
      id: 'avg-check',
      label: 'Сумма средних чеков',
      value: formatAmount(data.kpis.portfolioGmv),
      scope: 'срез на сейчас, период не влияет',
      delta: null,
      definition:
        'Сумма поля pulse_metrics.avg_check по всем клиентам. Это не GMV и не выручка: оборот в базе не хранится. Валюта у поля тоже не задана, поэтому знак валюты не выводится.',
      facts: avgCheckFacts,
      missing:
        detail.avgCheck.filled === 0
          ? 'Ни у одного клиента не заполнен средний чек, поэтому сумма равна нулю. Заполните поле в карточках клиентов.'
          : undefined,
      links: [{ label: 'Клиенты', href: '/clients' }],
    },
    {
      id: 'active-clients',
      label: 'Активные клиенты',
      value: formatNumber(data.kpis.activeClients),
      scope: 'срез на сейчас, период не влияет',
      delta: null,
      definition:
        'Клиенты со статусом «активен» в таблице clients. Статус проставляется вручную в карточке клиента; история его изменений не хранится, поэтому динамику показать нельзя.',
      facts: [
        { label: 'Всего клиентов', value: formatNumber(detail.clients.total) },
        ...detail.clients.statusCounts.map((row) => ({
          label: CLIENT_STATUS_LABELS[row.status] ?? row.status,
          value: formatNumber(row.count),
        })),
      ],
      links: [{ label: 'Клиенты', href: '/clients' }],
    },
    {
      id: 'risk-share',
      label: 'Доля в зоне риска',
      value: formatPercent(data.kpis.churnRate),
      scope: 'срез на сейчас, это не отток',
      delta: null,
      definition:
        'Доля клиентов со статусом «в зоне риска» или «неактивен» от всех клиентов. Настоящий отток за период посчитать нельзя: история смены статусов в базе не сохраняется.',
      facts: [
        { label: 'В зоне риска', value: formatNumber(atRisk) },
        { label: 'Неактивные', value: formatNumber(inactive) },
        { label: 'Всего клиентов', value: formatNumber(detail.clients.total) },
      ],
      missing:
        detail.clients.total === 0
          ? 'В базе нет ни одного клиента, поэтому доля не считается.'
          : undefined,
      links: [{ label: 'Клиенты', href: '/clients' }],
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Аналитика</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Метрики портфеля. Данные рассчитаны {formatDateTime(detail.period.to)}.
          </p>
        </div>
        <AnalyticsPeriodTabs active={periodId} />
      </div>

      <AnalyticsKpiGrid tiles={tiles} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-container rounded-xl p-6">
          <div className="flex justify-between items-center gap-4 mb-6">
            <h3 className="font-headline text-lg font-bold text-on-surface">Динамика GRI</h3>
            <span className="text-xs font-mono text-on-surface-variant whitespace-nowrap">{period.label}</span>
          </div>
          {detail.trend.length === 0 ? (
            <CardEmpty
              text={`За ${period.genitive} нет ни одного GRI-отчёта. Расчёт появится здесь сразу после диагностики.`}
              href="/gri"
              action="Запустить GRI-диагностику"
            />
          ) : (
            <GriTrendChart points={detail.trend} total={detail.gri.reportCount} />
          )}
        </div>

        <div className="bg-surface-container rounded-xl p-6">
          <div className="flex justify-between items-center gap-4 mb-6">
            <h3 className="font-headline text-lg font-bold text-on-surface">Средний чек по отраслям</h3>
            <span className="text-xs font-mono text-on-surface-variant whitespace-nowrap">срез на сейчас</span>
          </div>
          {industryRows.length === 0 || industryTotal === 0 ? (
            <CardEmpty
              text="Ни у одного клиента не заполнен средний чек, поэтому разбивку по отраслям построить не из чего."
              href="/clients"
              action="Заполнить в карточках клиентов"
            />
          ) : (
            <>
              <IndustryBreakdown rows={industryRows} total={industryTotal} />
              <p className="text-xs text-on-surface-variant mt-5 pt-4 border-t border-outline-variant/10">
                Топ-5 отраслей по сумме поля <code className="font-mono">pulse_metrics.avg_check</code>. Нажмите
                строку, чтобы увидеть долю, число клиентов и средний чек на клиента.
              </p>
            </>
          )}
        </div>
      </div>

      <ClientPerformanceTable rows={data.clientPerformance} griReportCounts={griReportCounts} />
    </div>
  )
}
