// Shared currency helpers for the AIStart360 portal. Parses user-typed
// strings like "₸4.2M", "$2M", "1.5 млрд", "360 000 000" into raw KZT
// integers, and formats KZT integers back into compact Russian labels
// ("₸4,2M", "90 млн ₸").
//
// Used by RevenueTargetsCard, GrowthSnapshotHero, period-goals editors.

export const FX_RATE_USD_KZT = 450

export function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null
  const cleaned = raw.replace(/\s/g, '').toLowerCase()
  const numMatch = cleaned.match(/([0-9]+([.,][0-9]+)?)/)
  if (!numMatch) return null
  const n = parseFloat(numMatch[1].replace(',', '.'))
  if (!Number.isFinite(n)) return null

  let multiplier = 1
  if (/млрд|b(?!yte)|bn|billion/i.test(cleaned)) multiplier = 1_000_000_000
  else if (/млн|m(?!s)|million/i.test(cleaned)) multiplier = 1_000_000
  else if (/тыс|k(?!g)/i.test(cleaned)) multiplier = 1_000

  let kzt = n * multiplier
  if (/\$|usd|долл/i.test(cleaned)) kzt *= FX_RATE_USD_KZT
  return Math.round(kzt)
}

export function formatKzt(value: number | null): string {
  if (value === null) return ''
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace('.0', '')} млрд ₸`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)} млн ₸`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} тыс ₸`
  return `${value.toLocaleString('ru-RU')} ₸`
}

/**
 * Compact metric-tile style: "₸4,2M", "₸90M", "₸1,5B". Used in the
 * growth-snapshot hero where we need very dense numbers.
 */
export function formatKztCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    return `${sign}₸${(abs / 1_000_000_000).toFixed(1).replace('.', ',').replace(',0', '')}B`
  }
  if (abs >= 1_000_000) {
    return `${sign}₸${(abs / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`
  }
  if (abs >= 1_000) {
    return `${sign}₸${(abs / 1_000).toFixed(0)}K`
  }
  return `${sign}₸${abs.toLocaleString('ru-RU')}`
}

export function currentMonthLabel(d: Date = new Date()): string {
  return d.toLocaleDateString('ru-RU', { month: 'long' })
}
