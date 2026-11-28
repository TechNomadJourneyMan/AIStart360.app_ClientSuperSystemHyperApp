export function formatKzt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('ru-RU')} ₸`
}

export function formatCompactKzt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString('ru-RU', {
      maximumFractionDigits: 1,
    })} млрд ₸`
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('ru-RU', {
      maximumFractionDigits: 1,
    })} млн ₸`
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toLocaleString('ru-RU', {
      maximumFractionDigits: 1,
    })} тыс. ₸`
  }
  return formatKzt(value)
}

export function formatNumber(value: number | null, maximumFractionDigits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('ru-RU', { maximumFractionDigits })
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatPeriod(period: { from: string; to: string } | null): string {
  if (!period) return 'Период не определён'
  if (period.from === period.to) return formatDate(period.from)
  return `${formatDate(period.from)} — ${formatDate(period.to)}`
}

export function availabilityLabel(value: string): string {
  if (value === 'in_stock') return 'В наличии'
  if (value === 'out_of_stock') return 'Нет в наличии'
  if (value === 'preorder') return 'Предзаказ'
  if (value === 'discontinued') return 'Снят с продажи'
  return 'Наличие не подтверждено'
}
