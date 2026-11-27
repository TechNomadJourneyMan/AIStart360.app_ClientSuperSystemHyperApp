import type {
  StoreAlert,
  StoreChannelSummary,
  StoreInventoryFact,
  StoreSalesFact,
  StoreSalesMetrics,
  StoreWarehouseSummary,
} from './types'

function finite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateSalesMetrics(rows: StoreSalesFact[]): StoreSalesMetrics {
  if (rows.length === 0) {
    return {
      revenue: null,
      cost: null,
      grossProfit: null,
      grossMarginPct: null,
      listRevenue: null,
      discount: null,
      discountRatePct: null,
      units: null,
      returns: null,
    }
  }
  const revenue = roundMoney(rows.reduce((sum, row) => sum + row.netRevenue, 0))
  const listRevenue = roundMoney(rows.reduce((sum, row) => sum + row.listAmount, 0))
  const units = rows.reduce((sum, row) => sum + row.quantity, 0)
  const returns = Math.abs(rows
    .filter((row) => row.quantity < 0)
    .reduce((sum, row) => sum + row.quantity, 0))
  const hasCost = rows.length > 0 && rows.every((row) => finite(row.costAmount) !== null)
  const hasDiscount = rows.length > 0
    && rows.every((row) => finite(row.discountAmount) !== null)
  const cost = hasCost
    ? roundMoney(rows.reduce((sum, row) => sum + (row.costAmount ?? 0), 0))
    : null
  const grossProfit = cost === null ? null : roundMoney(revenue - cost)
  const grossMarginPct = grossProfit === null || revenue === 0
    ? null
    : roundPercent((grossProfit / revenue) * 100)
  const discount = hasDiscount
    ? roundMoney(rows.reduce((sum, row) => sum + (row.discountAmount ?? 0), 0))
    : null
  const discountRatePct = discount === null || listRevenue === 0
    ? null
    : roundPercent((discount / listRevenue) * 100)

  return {
    revenue,
    cost,
    grossProfit,
    grossMarginPct,
    listRevenue,
    discount,
    discountRatePct,
    units,
    returns,
  }
}

export function summarizeChannels(rows: StoreSalesFact[]): StoreChannelSummary[] {
  const byChannel = new Map<string, StoreSalesFact[]>()
  for (const row of rows) {
    const channel = row.channel.trim() || 'Не указан'
    const current = byChannel.get(channel) ?? []
    current.push(row)
    byChannel.set(channel, current)
  }

  return Array.from(byChannel.entries())
    .map(([channel, facts]) => ({ channel, ...calculateSalesMetrics(facts) }))
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)
      || a.channel.localeCompare(b.channel, 'ru'))
}

export function summarizeWarehouses(
  rows: StoreInventoryFact[],
): StoreWarehouseSummary[] {
  const byWarehouse = new Map<string, StoreInventoryFact[]>()
  for (const row of rows) {
    const current = byWarehouse.get(row.warehouseName) ?? []
    current.push(row)
    byWarehouse.set(row.warehouseName, current)
  }

  return Array.from(byWarehouse.entries())
    .map(([warehouse, facts]) => {
      const hasCost = facts.every((fact) => finite(fact.purchasePrice) !== null)
      const hasRetail = facts.every((fact) => finite(fact.retailPrice) !== null)
      return {
        warehouse,
        available: facts.reduce((sum, fact) => sum + fact.quantityAvailable, 0),
        reserved: facts.reduce((sum, fact) => sum + fact.quantityReserved, 0),
        inventoryCost: hasCost
          ? roundMoney(facts.reduce(
              (sum, fact) => sum + fact.quantityAvailable * (fact.purchasePrice ?? 0),
              0,
            ))
          : null,
        inventoryRetail: hasRetail
          ? roundMoney(facts.reduce(
              (sum, fact) => sum + fact.quantityAvailable * (fact.retailPrice ?? 0),
              0,
            ))
          : null,
        snapshotDate: facts.reduce<string | null>(
          (latest, fact) => !latest || fact.snapshotDate > latest
            ? fact.snapshotDate
            : latest,
          null,
        ),
      }
    })
    .sort((a, b) => b.available - a.available || a.warehouse.localeCompare(b.warehouse, 'ru'))
}

export function buildStoreAlerts(input: {
  salesRows: StoreSalesFact[]
  inventoryRows: StoreInventoryFact[]
  hasPublishedSales: boolean
  hasPublishedInventory: boolean
  hasPublishedPrices: boolean
}): StoreAlert[] {
  const alerts: StoreAlert[] = []
  const metrics = calculateSalesMetrics(input.salesRows)

  if (!input.hasPublishedSales) {
    alerts.push({
      id: 'sales-missing',
      level: 'warning',
      title: 'Нет опубликованного отчёта продаж',
      description: 'Выручка и прибыль ограничены данными MyHonor. Загрузите и подтвердите строковый отчёт продаж.',
      actionHref: '/store/imports',
      actionLabel: 'Импортировать продажи',
    })
  }
  if (!input.hasPublishedInventory) {
    alerts.push({
      id: 'inventory-missing',
      level: 'warning',
      title: 'Остатки ещё не подключены',
      description: 'Система пока не может показать дефицит, затоваривание и стоимость запасов.',
      actionHref: '/store/imports',
      actionLabel: 'Импортировать остатки',
    })
  }
  if (!input.hasPublishedPrices) {
    alerts.push({
      id: 'prices-missing',
      level: 'info',
      title: 'Нет утверждённого прайса',
      description: 'Закупочная стоимость и ценовые уровни будут доступны после публикации прайса.',
    })
  }
  if (metrics.grossMarginPct !== null && metrics.grossMarginPct < 30) {
    alerts.push({
      id: 'low-margin',
      level: 'critical',
      title: 'Маржа ниже безопасного уровня',
      description: `В последнем периоде валовая маржа ${metrics.grossMarginPct.toLocaleString('ru-RU')}%. Проверьте скидки и убыточные товары.`,
    })
  }
  if (metrics.discountRatePct !== null && metrics.discountRatePct >= 30) {
    alerts.push({
      id: 'high-discount',
      level: 'warning',
      title: 'Скидки забирают более 30% прайсовой выручки',
      description: `Средневзвешенное влияние скидок — ${metrics.discountRatePct.toLocaleString('ru-RU')}%.`,
    })
  }

  return alerts
}
