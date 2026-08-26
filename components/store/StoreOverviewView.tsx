'use client'

import Link from 'next/link'
import { useState } from 'react'
import type {
  StoreAlertLevel,
  StoreAnalyticsCoverage,
  StoreAnalyticsSource,
  StoreAnalyticsWindowKey,
  StoreOverview,
  StorePnlPeriod,
} from '@/lib/store/types'
import {
  availabilityLabel,
  formatCompactKzt,
  formatDate,
  formatKzt,
  formatNumber,
  formatPercent,
  formatPeriod,
} from '@/lib/store/format'

function sourceLabel(data: StoreOverview): string {
  if (data.source === 'operational') return 'Утверждённые отчёты'
  if (data.source === 'myhonor') return 'MyHonor · наблюдаемые заказы'
  return 'Данные не подключены'
}

function analyticsSourceLabel(source: StoreAnalyticsSource): string {
  if (source === 'operational') return 'опубликованные продажи'
  if (source === 'financial_report') return 'управленческий отчёт'
  if (source === 'myhonor') return 'наблюдаемые заказы MyHonor'
  if (source === 'mixed') return 'непересекающиеся опубликованные источники'
  return 'источник не покрывает период'
}

function coverageLabel(coverage: StoreAnalyticsCoverage): string {
  if (coverage === 'complete') return 'Полные данные'
  if (coverage === 'partial') return 'Частичное покрытие'
  if (coverage === 'stale') return 'Источник устарел'
  if (coverage === 'unavailable') return 'Временно недоступно'
  return 'Период не покрыт'
}

function coverageTone(coverage: StoreAnalyticsCoverage): string {
  if (coverage === 'complete') return 'border-primary/25 bg-primary/[0.08] text-primary'
  if (coverage === 'partial') return 'border-tertiary-container/25 bg-tertiary-container/[0.08] text-tertiary-container'
  if (coverage === 'unavailable') return 'border-error/25 bg-error/[0.08] text-error'
  return 'border-white/10 bg-white/[0.03] text-on-surface-variant'
}

function formatMonth(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return month
  return parsed.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatPnlRange(periods: StorePnlPeriod[]): string {
  const first = periods[0]?.month
  const last = periods.at(-1)?.month
  if (!first || !last) return 'период не опубликован'
  if (first === last) return formatMonth(first)
  return `${formatMonth(first)} — ${formatMonth(last)}`
}

function formatPnlKzt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₸`
}

function alertTone(level: StoreAlertLevel): string {
  if (level === 'critical') return 'border-error/25 bg-error/[0.07] text-error'
  if (level === 'warning') return 'border-tertiary-container/25 bg-tertiary-container/[0.07] text-tertiary-container'
  return 'border-secondary/20 bg-secondary/[0.06] text-secondary'
}

function statusTone(ready: boolean): string {
  return ready
    ? 'border-primary/20 bg-primary/[0.06] text-primary'
    : 'border-white/[0.07] bg-white/[0.025] text-on-surface-variant'
}

interface KpiProps {
  label: string
  value: string
  detail: string
  icon: string
  tone?: 'default' | 'good' | 'warning'
}

function Kpi({ label, value, detail, icon, tone = 'default' }: KpiProps) {
  const toneClass = tone === 'good'
    ? 'text-primary'
    : tone === 'warning'
      ? 'text-tertiary-container'
      : 'text-on-surface'
  return (
    <article className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-on-surface-variant">
            {label}
          </p>
          <p className={`mt-3 truncate font-mono text-2xl font-bold tabular-nums ${toneClass}`}>
            {value}
          </p>
        </div>
        <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-lg text-on-surface-variant">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{detail}</p>
    </article>
  )
}

function EmptySection({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/30 px-5 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/50">{icon}</span>
      <p className="mt-3 text-sm font-semibold text-on-surface">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-on-surface-variant">{text}</p>
    </div>
  )
}

export function StoreOverviewView({ data }: { data: StoreOverview }) {
  const [windowKey, setWindowKey] = useState<StoreAnalyticsWindowKey>('latestPublished')
  const analytics = data.analytics
  const selectedSlice = analytics?.windows[windowKey]
  const metrics = selectedSlice?.metrics ?? data.metrics
  const selectedPeriod = selectedSlice?.period ?? data.period
  const marginTone = metrics.grossMarginPct !== null && metrics.grossMarginPct >= 40
    ? 'good'
    : metrics.grossMarginPct !== null && metrics.grossMarginPct < 30
      ? 'warning'
      : 'default'
  const dataStatuses = [
    { label: 'Продажи', ready: data.availability.sales, icon: 'receipt_long', freshness: analytics?.freshness.sales },
    { label: 'Остатки', ready: data.availability.inventory, icon: 'inventory_2', freshness: analytics?.freshness.inventory },
    { label: 'Прайс', ready: data.availability.prices, icon: 'sell', freshness: analytics?.freshness.prices },
    { label: 'Каталог', ready: data.catalog.products > 0, icon: 'category', freshness: analytics?.freshness.catalog },
  ]
  const windowOptions: Array<{ key: StoreAnalyticsWindowKey; label: string }> = [
    { key: 'today', label: 'Сегодня' },
    { key: 'monthToDate', label: 'Этот месяц' },
    { key: 'latestPublished', label: 'Последний опубликованный' },
    { key: 'yearToDate', label: `${analytics?.comparableYtd.currentYear ?? 'Текущий год'} YTD` },
    { key: 'previousYear', label: String(analytics?.comparableYtd.previousYear ?? 'Прошлый год') },
  ]
  const maxHistoryValue = Math.max(
    1,
    ...(analytics?.history.flatMap((period) => [
      Math.abs(period.metrics.revenue ?? 0),
      Math.abs(period.metrics.grossProfit ?? 0),
    ]) ?? []),
  )
  const historyHasNegative = analytics?.history.some((period) => (
    (period.metrics.revenue ?? 0) < 0 || (period.metrics.grossProfit ?? 0) < 0
  )) ?? false
  // Always show the newest published P&L periods. The former May–July range
  // silently hid August (and every later upload) even though analytics already
  // contained it.
  const visiblePnlPeriods = analytics?.pnl.periods.slice(-3) ?? []
  const visiblePnlCoverage: StoreAnalyticsCoverage = visiblePnlPeriods.length === 0
    ? analytics?.pnl.coverage ?? 'not_covered'
    : visiblePnlPeriods.every((period) => period.coverage === 'complete')
      ? 'complete'
      : 'partial'
  const visiblePnlEbitda = visiblePnlPeriods.length > 0
    && visiblePnlPeriods.every((period) => period.ebitda !== null)
    ? Math.round((visiblePnlPeriods.reduce((sum, period) => sum + (period.ebitda ?? 0), 0) + Number.EPSILON) * 100) / 100
    : null
  const visiblePnlLabel = formatPnlRange(visiblePnlPeriods)

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.10] via-surface-container-low to-surface-container-low p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary">
                Store Control Center
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono text-primary">
                {sourceLabel(data)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="material-symbols-outlined flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-2xl text-primary">
                storefront
              </span>
              <div className="min-w-0">
                <h1 className="font-headline text-2xl font-extrabold text-on-surface md:text-3xl">
                  Магазин
                </h1>
                <p className="mt-0.5 truncate text-sm text-on-surface-variant">
                  {data.companyName ?? 'Ваш бизнес'} · {formatPeriod(data.period)}
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Продажи, P&amp;L, маржа, цены и остатки в одном проверяемом контуре. Пустой период без watermark полноты не выдаётся за нулевую выручку.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
            <Link
              href="/client/journey/store"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/[0.10]"
            >
              <span className="material-symbols-outlined text-lg">route</span>
              Открыть в Journey
            </Link>
            <Link
              href="/store/imports"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-lg">upload_file</span>
              Проверить файл
            </Link>
            <a
              href="https://myhonor.shop"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:border-primary/30 hover:text-primary"
            >
              Витрина MyHonor
              <span className="material-symbols-outlined text-base">open_in_new</span>
            </a>
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-4 text-xs text-on-surface-variant">
          <span className="inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">schedule</span>
            Актуально: {formatDate(data.asOf)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">verified</span>
            {data.versionLabel ?? 'Нет утверждённой версии'}
          </span>
        </div>
      </header>

      <section aria-labelledby="store-data-status-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="store-data-status-title" className="font-headline text-base font-bold text-on-surface">
              Готовность данных
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Зелёный статус означает, что источник подключён и участвует в расчётах.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dataStatuses.map((item) => (
              <div key={item.label} className={`min-w-0 rounded-xl border px-3 py-2 ${statusTone(item.ready)}`}>
                <div className="flex min-h-7 items-center gap-2">
                  <span className="material-symbols-outlined text-base">{item.ready ? 'check_circle' : item.icon}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
                {item.freshness && (
                  <p className="truncate text-[9px] opacity-75" title={coverageLabel(item.freshness.coverage)}>
                    {coverageLabel(item.freshness.coverage)} · {formatDate(item.freshness.lastFactAt)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {analytics && (
        <section aria-labelledby="store-window-title" className="min-w-0 rounded-2xl border border-primary/15 bg-surface-container-low p-4 md:p-5">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Asia/Almaty · schema v{analytics.schemaVersion}</p>
              <h2 id="store-window-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Период дашборда</h2>
            </div>
            <div role="group" aria-label="Выбрать период дашборда" className="flex max-w-full flex-wrap gap-2">
              {windowOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={windowKey === option.key}
                  onClick={() => setWindowKey(option.key)}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    windowKey === option.key
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-white/[0.08] bg-white/[0.02] text-on-surface-variant hover:border-primary/25 hover:text-on-surface'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {selectedSlice && (
              <div aria-live="polite" className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{formatPeriod(selectedSlice.period)}</p>
                  <p className="mt-1 break-words text-xs text-on-surface-variant">
                    Источник: {analyticsSourceLabel(selectedSlice.source)}
                    {selectedSlice.scopeKeys.length > 0 ? ` · scope ${selectedSlice.scopeKeys.join(', ')}` : ''}
                    {selectedSlice.publishedAt ? ` · опубликовано ${formatDate(selectedSlice.publishedAt)}` : ''}
                  </p>
                  {selectedSlice.message && <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{selectedSlice.message}</p>}
                </div>
                <span className={`shrink-0 self-start rounded-full border px-2.5 py-1 text-[10px] font-semibold ${coverageTone(selectedSlice.coverage)}`}>
                  {coverageLabel(selectedSlice.coverage)}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="store-kpi-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Экономика периода</p>
            <h2 id="store-kpi-title" className="mt-1 font-headline text-xl font-bold text-on-surface">Главные показатели</h2>
          </div>
          <p className="hidden text-xs text-on-surface-variant sm:block">{formatPeriod(selectedPeriod)}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
          <Kpi label="Выручка" value={formatCompactKzt(metrics.revenue)} detail="После скидок и возвратов" icon="payments" />
          <Kpi label="Валовая прибыль" value={formatCompactKzt(metrics.grossProfit)} detail={metrics.cost === null ? 'Нужна историческая себестоимость' : `Себестоимость: ${formatCompactKzt(metrics.cost)}`} icon="trending_up" tone={metrics.grossProfit !== null && metrics.grossProfit > 0 ? 'good' : 'default'} />
          <Kpi label="Валовая маржа" value={formatPercent(metrics.grossMarginPct)} detail="Валовая прибыль / выручка" icon="percent" tone={marginTone} />
          <Kpi label="Влияние скидок" value={formatCompactKzt(metrics.discount)} detail={metrics.discountRatePct === null ? 'Нет подтверждённого расчёта' : `${formatPercent(metrics.discountRatePct)} от прайсовой выручки`} icon="sell" tone={metrics.discountRatePct !== null && metrics.discountRatePct >= 30 ? 'warning' : 'default'} />
          <Kpi label="Продано единиц" value={formatNumber(metrics.units, 1)} detail={metrics.returns !== null ? `Возвратов: ${formatNumber(metrics.returns, 1)}` : 'Возвраты для периода не покрыты'} icon="shopping_bag" />
          <Kpi label="Запас по закупу" value={formatCompactKzt(data.inventory.inventoryCost)} detail={data.inventory.availableUnits === null ? 'Остатки ещё не опубликованы' : `Доступно: ${formatNumber(data.inventory.availableUnits, 1)} ед.`} icon="inventory_2" />
        </div>
      </section>

      {analytics && analytics.history.length > 0 && (
        <section aria-labelledby="store-history-title" className="min-w-0 rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Динамика</p>
              <h2 id="store-history-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Выручка по месяцам</h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-primary/70" />Выручка</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-secondary/65" />Валовая прибыль</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-tertiary-container/70" />Частичный месяц</span>
              {historyHasNegative && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-error/70" />Отрицательное значение</span>}
            </div>
          </div>

          <div aria-hidden="true" className="mt-5 flex h-44 min-w-0 items-end gap-1.5 overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.015] px-2 pb-2 pt-5 sm:gap-2 sm:px-3">
            {analytics.history.map((period) => {
              const revenueHeight = period.metrics.revenue === null
                ? 4
                : Math.max(8, (Math.abs(period.metrics.revenue) / maxHistoryValue) * (historyHasNegative ? 48 : 100))
              const grossProfitHeight = period.metrics.grossProfit === null
                ? 4
                : Math.max(8, (Math.abs(period.metrics.grossProfit) / maxHistoryValue) * (historyHasNegative ? 48 : 100))
              return (
                <div key={period.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="relative flex min-h-0 w-full flex-1 items-stretch justify-center gap-px">
                    {historyHasNegative && <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/10" />}
                    <div
                      className={`absolute w-[48%] max-w-5 ${period.metrics.revenue !== null && period.metrics.revenue < 0 ? 'rounded-b-sm bg-error/70' : `rounded-t-sm ${period.coverage === 'complete' ? 'bg-primary/70' : 'bg-tertiary-container/70'}`}`}
                      style={{
                        height: `${revenueHeight}%`,
                        left: '8%',
                        ...(historyHasNegative
                          ? period.metrics.revenue !== null && period.metrics.revenue < 0
                            ? { top: '50%' }
                            : { bottom: '50%' }
                          : { bottom: 0 }),
                      }}
                      title={`${formatMonth(period.month)} · Выручка: ${formatKzt(period.metrics.revenue)}`}
                    />
                    <div
                      className={`absolute w-[36%] max-w-4 ${period.metrics.grossProfit !== null && period.metrics.grossProfit < 0 ? 'rounded-b-sm bg-error/70' : `rounded-t-sm ${period.coverage === 'complete' ? 'bg-secondary/65' : 'bg-tertiary-container/35'}`}`}
                      style={{
                        height: `${grossProfitHeight}%`,
                        right: '8%',
                        ...(historyHasNegative
                          ? period.metrics.grossProfit !== null && period.metrics.grossProfit < 0
                            ? { top: '50%' }
                            : { bottom: '50%' }
                          : { bottom: 0 }),
                      }}
                      title={`${formatMonth(period.month)} · Валовая прибыль: ${formatKzt(period.metrics.grossProfit)}`}
                    />
                  </div>
                  <span className="max-w-full truncate text-[8px] text-on-surface-variant sm:text-[9px]">{period.month.slice(2)}</span>
                </div>
              )
            })}
          </div>

          <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-white/[0.05]">
            <table className="w-full min-w-[720px] text-left text-xs">
              <caption className="sr-only">Табличная альтернатива графику месячной выручки</caption>
              <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-3 py-3 font-medium">Месяц</th>
                  <th className="px-3 py-3 text-right font-medium">Выручка</th>
                  <th className="px-3 py-3 text-right font-medium">Себестоимость</th>
                  <th className="px-3 py-3 text-right font-medium">Валовая прибыль</th>
                  <th className="px-3 py-3 font-medium">Источник</th>
                  <th className="px-3 py-3 font-medium">Покрытие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {analytics.history.map((period) => (
                  <tr key={period.month}>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-on-surface">{formatMonth(period.month)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-on-surface">{formatKzt(period.metrics.revenue)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatKzt(period.metrics.cost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatKzt(period.metrics.grossProfit)}</td>
                    <td className="px-3 py-3 text-on-surface-variant">{analyticsSourceLabel(period.source)}</td>
                    <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[9px] ${coverageTone(period.coverage)}`}>{coverageLabel(period.coverage)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {analytics && (
        <section aria-labelledby="store-comparable-title" className="grid min-w-0 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <article className="min-w-0 rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">YoY · сопоставимый YTD</p>
            <h2 id="store-comparable-title" className="mt-1 font-headline text-lg font-bold text-on-surface">
              {analytics.comparableYtd.currentYear} против {analytics.comparableYtd.previousYear}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[10px] text-on-surface-variant">Изменение выручки</p>
                <p className="mt-2 font-mono text-xl font-bold tabular-nums text-on-surface">{formatPercent(analytics.comparableYtd.revenueChangePct)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[10px] text-on-surface-variant">Изменение валовой прибыли</p>
                <p className="mt-2 font-mono text-xl font-bold tabular-nums text-on-surface">{formatPercent(analytics.comparableYtd.grossProfitChangePct)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              {analytics.comparableYtd.message ?? `Сравнены одинаковые периоды: ${formatPeriod(analytics.comparableYtd.current.period)} и ${formatPeriod(analytics.comparableYtd.previous.period)}.`}
            </p>
          </article>

          <article className="min-w-0 rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">P&amp;L · {visiblePnlLabel}</p>
                <h2 className="mt-1 font-headline text-lg font-bold text-on-surface">Прибыль и расходы периода</h2>
              </div>
              <span className={`self-start rounded-full border px-2.5 py-1 text-[10px] ${coverageTone(visiblePnlCoverage)}`}>{coverageLabel(visiblePnlCoverage)}</span>
            </div>
            {visiblePnlEbitda !== null && visiblePnlEbitda < 0 && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-error/25 bg-error/[0.07] p-3 text-error">
                <span className="material-symbols-outlined text-lg">warning</span>
                <p className="text-xs leading-relaxed">Отрицательная EBITDA: {formatPnlKzt(visiblePnlEbitda)}. Расходы видимого периода выше валовой прибыли.</p>
              </div>
            )}
            {visiblePnlPeriods.length === 0 ? (
              <div className="mt-4"><EmptySection icon="account_balance" title="P&amp;L ещё не опубликован" text={analytics.pnl.message ?? 'Загрузите управленческий отчёт.'} /></div>
            ) : (
              <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-white/[0.05]">
                <table className="w-full min-w-[1220px] text-left text-xs">
                  <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="px-3 py-3 font-medium">Месяц</th>
                      <th className="px-3 py-3 text-right font-medium">Выручка</th>
                      <th className="px-3 py-3 text-right font-medium">Себестоимость</th>
                      <th className="px-3 py-3 text-right font-medium">Валовая прибыль</th>
                      <th className="px-3 py-3 text-right font-medium">Расходы периода</th>
                      <th className="px-3 py-3 text-right font-medium">Бонусы*</th>
                      <th className="px-3 py-3 text-right font-medium">Списания*</th>
                      <th className="px-3 py-3 text-right font-medium">EBITDA</th>
                      <th className="px-3 py-3 font-medium">Покрытие</th>
                      <th className="px-3 py-3 font-medium">Источник / сверка</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {visiblePnlPeriods.map((period) => (
                      <tr key={period.month}>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-on-surface">{formatMonth(period.month)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{formatPnlKzt(period.revenue)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{formatPnlKzt(period.costAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{formatPnlKzt(period.grossProfit)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{formatPnlKzt(period.periodExpenses)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatPnlKzt(period.bonuses)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatPnlKzt(period.writeOffs)}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-mono font-bold tabular-nums ${period.ebitda !== null && period.ebitda < 0 ? 'text-error' : 'text-primary'}`}>{formatPnlKzt(period.ebitda)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={`rounded-full border px-2 py-1 text-[9px] ${coverageTone(period.coverage)}`}>
                            {coverageLabel(period.coverage)}
                          </span>
                        </td>
                        <td className="min-w-64 px-3 py-3 text-[10px] leading-relaxed text-on-surface-variant">
                          <p className="text-on-surface">{period.sourceSheet ?? (period.source === 'financial_report' ? 'Управленческий отчёт' : 'Продажи без полного P&L')}</p>
                          <p className="break-words">{period.scopeKey ?? 'scope не указан'}{period.publishedAt ? ` · опубликовано ${formatDate(period.publishedAt)}` : ''}</p>
                          {period.note && <p className="mt-1 break-words text-tertiary-container">Сверка: {period.note}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-on-surface-variant">* Бонусы и списания — детализация внутри «Расходов периода» и не вычитаются из EBITDA повторно.</p>
            {visiblePnlCoverage !== 'complete' && analytics.pnl.message && (
              <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{analytics.pnl.message}</p>
            )}
          </article>
        </section>
      )}

      {data.alerts.length > 0 && (
        <section aria-labelledby="store-alerts-title">
          <div className="mb-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-tertiary-container">Требует внимания</p>
            <h2 id="store-alerts-title" className="mt-1 font-headline text-xl font-bold text-on-surface">Что сделать сейчас</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.alerts.map((alert) => (
              <article key={alert.id} className={`rounded-2xl border p-4 ${alertTone(alert.level)}`}>
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-xl">
                    {alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-on-surface">{alert.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{alert.description}</p>
                    {alert.actionHref && alert.actionLabel && (
                      <Link href={alert.actionHref} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-bold text-current hover:underline">
                        {alert.actionLabel}
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section aria-labelledby="store-channels-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Каналы продаж</p>
            <h2 id="store-channels-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Где создаётся прибыль</h2>
          </div>
          {data.channels.length === 0 ? (
            <EmptySection icon="bar_chart" title="Нет данных по каналам" text="После публикации строк продаж здесь появятся магазин, Kaspi и оптовые каналы." />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="px-2 py-3 font-medium">Канал</th>
                      <th className="px-2 py-3 text-right font-medium">Выручка</th>
                      <th className="px-2 py-3 text-right font-medium">Прибыль</th>
                      <th className="px-2 py-3 text-right font-medium">Маржа</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {data.channels.map((channel) => (
                      <tr key={channel.channel} className="table-row-hover">
                        <td className="px-2 py-3 font-medium text-on-surface">{channel.channel}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface">{formatCompactKzt(channel.revenue)}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatCompactKzt(channel.grossProfit)}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatPercent(channel.grossMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {data.channels.map((channel) => (
                  <article key={channel.channel} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-on-surface">{channel.channel}</h3>
                      <span className="font-mono text-sm font-bold tabular-nums text-on-surface">{formatCompactKzt(channel.revenue)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                      <span>Прибыль: {formatCompactKzt(channel.grossProfit)}</span>
                      <span>Маржа: {formatPercent(channel.grossMarginPct)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="store-warehouses-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Остатки</p>
            <h2 id="store-warehouses-title" className="mt-1 font-headline text-lg font-bold text-on-surface">По складам</h2>
          </div>
          {data.inventory.warehouses.length === 0 ? (
            <EmptySection icon="warehouse" title="Склады ещё не подключены" text="Опубликуйте снимок остатков, чтобы видеть стоимость и распределение запасов." />
          ) : (
            <div className="space-y-2">
              {data.inventory.warehouses.map((warehouse) => (
                <article key={warehouse.warehouse} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">{warehouse.warehouse}</h3>
                      <p className="mt-1 text-[10px] text-on-surface-variant">Снимок: {formatDate(warehouse.snapshotDate)}</p>
                    </div>
                    <span className="font-mono text-lg font-bold tabular-nums text-on-surface">{formatNumber(warehouse.available, 1)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                    <span>единиц доступно</span>
                    <span>{formatCompactKzt(warehouse.inventoryCost)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="store-catalog-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Каталог</p>
            <h2 id="store-catalog-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Товары в контуре</h2>
          </div>
          <p className="text-xs text-on-surface-variant">
            Активно {formatNumber(data.catalog.activeProducts)} из {formatNumber(data.catalog.products)}
          </p>
        </div>
        {data.catalog.latest.length === 0 ? (
          <EmptySection
            icon="category"
            title={data.catalog.products > 0
              ? data.catalog.activeProducts === 0 ? 'Нет активных товаров' : 'Каталог подключён'
              : 'Каталог пуст'}
            text={data.catalog.products > 0
              ? data.catalog.activeProducts === 0
                ? `В контуре ${formatNumber(data.catalog.products)} товаров, но ни один не отмечен активным.`
                : `В контуре ${formatNumber(data.catalog.products)} товаров; карточки последних активных позиций пока не получены.`
              : 'Синхронизируйте MyHonor или опубликуйте мастер-прайс.'}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.catalog.latest.map((product) => (
              <article key={product.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-lg text-primary">apparel</span>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-on-surface">{product.name}</h3>
                    <p className="mt-1 truncate font-mono text-[10px] text-on-surface-variant">{product.sku}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2 border-t border-white/[0.05] pt-3">
                  <span className="font-mono text-sm font-bold tabular-nums text-on-surface">{formatCompactKzt(product.price)}</span>
                  <span className="text-[10px] text-on-surface-variant">{availabilityLabel(product.availability)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {data.limitations.length > 0 && (
        <aside aria-label="Ограничения данных" className="rounded-2xl border border-secondary/15 bg-secondary/[0.04] p-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-lg text-secondary">shield_lock</span>
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Что пока не входит в расчёт</h2>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-on-surface-variant">
                {data.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}
              </ul>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
