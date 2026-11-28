import { createEmptyJourneyState } from './demo'
import { journeyStateSchema, journeyWidgetSchema, type JourneyFact, type JourneyState } from './schema'
import { formatKzt, formatNumber, formatPercent, formatPeriod } from '@/lib/store/format'
import type { StoreOverview } from '@/lib/store/types'

/** Pure projection of owner/company-scoped published aggregates; no demo facts. */
export function buildStoreJourneyState(overview: StoreOverview, options: { workspaceId: string; now?: string }): JourneyState {
  const now = options.now ?? new Date().toISOString()
  const base = createEmptyJourneyState(options.workspaceId)
  const analytics = overview.source === 'empty' ? undefined : overview.analytics
  const latest = analytics?.windows.latestPublished
  const usableSales = overview.source !== 'empty' && (latest
    ? !['not_covered', 'unavailable'].includes(latest.coverage) && latest.source !== 'none'
    : overview.availability.sales)
  const metrics = usableSales ? latest?.metrics ?? overview.metrics : null
  const period = latest?.period ?? overview.period
  const coverage = { complete: 'полное покрытие', partial: 'неполное покрытие', stale: 'устаревший источник', not_covered: 'период не покрыт', unavailable: 'источник недоступен' }
  const sourceName = latest ? {
    operational: 'Опубликованные продажи', myhonor: 'Синхронизация MyHonor', financial_report: 'Опубликованный финансовый отчёт',
    mixed: 'Смешанные опубликованные источники', none: 'Источник не подтверждён',
  }[latest.source] : overview.source === 'myhonor' ? 'MyHonor' : 'Опубликованные данные магазина'
  const source = `${sourceName} · ${formatPeriod(period)}${latest ? ` · ${coverage[latest.coverage]}` : ''}`
  const facts: JourneyFact[] = []
  const fact = (id: string, label: string, value: string | null, category: JourneyFact['category'], sourceLabel = source) => {
    if (value === null) return
    facts.push({ id: `fact:store:${id}`, label, value, category, sourceLabel, status: 'confirmed' })
  }
  const money = (value: number | null | undefined) => value == null ? null : formatKzt(value)
  const number = (value: number | null | undefined) => value == null ? null : formatNumber(value)
  const percent = (value: number | null | undefined) => value == null ? null : formatPercent(value)
  const metric = (label: string, value: string | null, sourceLabel = source) => ({
    label, ...(value !== null ? { value } : {}), status: value === null ? 'unknown' as const : 'known' as const, sourceLabel,
  })
  if (metrics && period) fact('period', 'Фактический период', formatPeriod(period), 'sales')
  fact('revenue', 'Выручка', money(metrics?.revenue), 'finance')
  fact('gross-profit', 'Валовая прибыль', money(metrics?.grossProfit), 'finance')
  fact('gross-margin', 'Валовая маржа', percent(metrics?.grossMarginPct), 'finance')
  const inventoryCoverage = analytics?.freshness.inventory.coverage
  const inventoryReady = overview.source !== 'empty' && overview.availability.inventory && !['not_covered', 'unavailable'].includes(inventoryCoverage ?? '')
  const inventorySource = `Опубликованный снимок остатков · ${overview.asOf ?? 'дата не указана'}${inventoryCoverage ? ` · ${coverage[inventoryCoverage]}` : ''}`
  fact('inventory', 'Доступный остаток', inventoryReady ? number(overview.inventory.availableUnits) : null, 'operations', inventorySource)
  const limitations = [...new Set([...overview.limitations, ...(analytics?.limitations ?? [])])]
  const nextTitle = !usableSales ? 'Опубликовать продажи магазина' : limitations.length ? 'Проверить полноту источников' : 'Выбрать измеримую Точку B'
  const nextAction = {
    id: 'roadmap:store:source', title: nextTitle,
    description: !usableSales ? 'Показатели продаж появятся после публикации проверенного источника в магазине.' : 'Сверьте период и источники. Затем задайте показатель, целевое значение и срок.',
    horizon: 'Следующий шаг', progress: 0, status: 'next' as const,
  }
  const pnl = analytics?.pnl.periods
    .filter((entry) => entry.coverage === 'complete' || entry.coverage === 'partial')
    .sort((a, b) => b.month.localeCompare(a.month))[0]
  const widgets = [
    {
      id: 'widget:store:finance', kind: 'finance_cashflow', title: 'Экономика магазина', priority: 100,
      position: { x: 100, y: 500 }, collapsed: false, hidden: false, focused: false,
      data: {
        sourceStatus: usableSales ? 'connected' : 'missing',
        metrics: [
          metric('Выручка', money(metrics?.revenue)), metric('Себестоимость', money(metrics?.cost)),
          metric('Валовая прибыль', money(metrics?.grossProfit)), metric('Валовая маржа', percent(metrics?.grossMarginPct)),
          metric('Скидки', money(metrics?.discount)), metric('Доля скидок', percent(metrics?.discountRatePct)),
          ...(pnl ? [metric(`EBITDA · ${pnl.month}`, money(pnl.ebitda), `Опубликованный P&L · ${pnl.month} · ${coverage[pnl.coverage]}`)] : []),
        ],
        nextQuestion: 'Какой показатель, целевое значение и срок выберет владелец?',
      },
    },
    {
      id: 'widget:store:operations', kind: 'domain_metrics', title: 'Ассортимент и остатки', priority: 95,
      position: { x: 430, y: 500 }, collapsed: false, hidden: false, focused: false,
      data: {
        domain: 'Магазин', purpose: 'Проверенные продажи и опубликованный снимок остатков.',
        metrics: [
          metric('Продано единиц', number(metrics?.units)), metric('Возвраты', number(metrics?.returns)),
          metric('Доступно на складах', inventoryReady ? number(overview.inventory.availableUnits) : null, inventorySource),
          metric('Зарезервировано', inventoryReady ? number(overview.inventory.reservedUnits) : null, inventorySource),
          metric('Товаров в контуре', overview.source === 'empty' || overview.catalog.products === 0 ? null : number(overview.catalog.products), 'Каталог текущего магазина'),
        ],
        guidance: limitations.slice(0, 2).map((detail) => ({ title: 'Ограничение данных', detail: detail.slice(0, 800), status: 'question' })),
      },
    },
    {
      id: 'widget:store:sources', kind: 'domain_process', title: 'Источники данных', priority: 90,
      position: { x: 760, y: 500 }, collapsed: false, hidden: false, focused: false,
      data: {
        domain: 'Магазин', purpose: 'Отделять опубликованные факты от отсутствующих источников.',
        stages: [['sales', 'Продажи', usableSales], ['inventory', 'Остатки', inventoryReady], ['prices', 'Прайс', overview.availability.prices]].map(([id, name, ready]) => ({
          id: `store:${id}`, name, status: ready ? 'done' : 'blocked', nextAction: ready ? 'Источник опубликован' : `Опубликовать источник «${name}»`,
        })),
      },
    },
    {
      id: 'widget:store:risks', kind: 'risks_opportunities', title: 'Сигналы и ограничения', priority: 85,
      position: { x: 1090, y: 500 }, collapsed: false, hidden: false, focused: false,
      data: {
        risks: [
          ...overview.alerts.filter((alert) => alert.level !== 'info').map((alert) => ({ title: alert.title, detail: alert.description.slice(0, 800), status: 'risk' })),
          ...limitations.map((detail) => ({ title: 'Ограничение данных', detail: detail.slice(0, 800), status: 'risk' })),
        ].slice(0, 8), opportunities: [],
      },
    },
  ].map((widget) => journeyWidgetSchema.parse(widget))
  return journeyStateSchema.parse({
    ...base, companyName: overview.companyName ?? '',
    businessDescription: 'Путь магазина от опубликованных фактов к подтверждённой цели.',
    phase: facts.length ? 'partial' : 'empty', facts, widgets, roadmap: [nextAction],
    messages: [{ id: 'message:store:source', role: 'assistant', createdAt: now,
      text: facts.length ? 'Точка A собрана из опубликованных данных магазина. Исходные показатели обновляются с сервера. Задайте измеримую Точку B — метрику, целевое значение и срок.' : 'Опубликованных данных пока недостаточно. Пустые показатели не считаются нулями. Начните с публикации источника в магазине.' }],
    suggestions: [], widgetOrder: widgets.map((widget) => widget.id),
    provider: { mode: 'unavailable', label: 'Опубликованные данные магазина' },
    persistence: { mode: 'database', label: 'Отдельная рабочая область магазина' }, updatedAt: now,
  })
}
