/**
 * Shared helpers for dashboard metric primitives.
 * Russian-formatting only — keep components clean.
 */

const RU_INT = new Intl.NumberFormat('ru-RU')

/**
 * Format a numeric metric value in Russian style:
 * - ≥ 1M → "1.2 млн"
 * - ≥ 1k → "12.5 тыс"
 * - else → "12 345"
 */
export function formatRuMetricValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} млн`
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)} тыс`
  }
  // Integer-ish: drop fractional 0s, but keep up to 2 decimals if present
  if (Number.isInteger(value)) {
    return RU_INT.format(value)
  }
  return RU_INT.format(Math.round(value * 100) / 100)
}

/**
 * Render the value + unit pair the way Point A wants:
 *   "₸" stays attached: "12.5 млн ₸"
 *   "%"  no space: "12.5%"
 *   "days" → " дн."
 *   "count" → "" (no unit)
 *   anything else → " {unit}"
 */
export function formatRuMetricWithUnit(
  value: number | string | null | undefined,
  unit?: string
): string {
  if (value === null || value === undefined || value === '') return '«—»'
  const num = typeof value === 'number' ? value : Number(value)
  const numeric = typeof value === 'number' || (!Number.isNaN(num) && value !== '')
  const base = numeric ? formatRuMetricValue(num) : String(value)
  switch (unit) {
    case '₸':
      return `${base} ₸`
    case '%':
      return `${base}%`
    case 'days':
      return `${base} дн.`
    case 'count':
    case '':
    case undefined:
      return base
    default:
      return `${base} ${unit}`
  }
}

/**
 * Convert ISO timestamp to relative Russian phrase.
 *   <60s    → "только что"
 *   <60min  → "N мин назад"
 *   <24h    → "N ч назад"
 *   else    → "dd.MM HH:mm"
 */
export function formatRuRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = now.getTime() - t
  if (diffMs < 0) return 'только что'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const d = new Date(t)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} ${hh}:${mi}`
}

/**
 * Map a 0..1 confidence to a small dot color class.
 *   ≥ 0.85 → bg-primary
 *   ≥ 0.6  → bg-amber-400/70
 *   else   → bg-on-surface-variant/40
 */
export function confidenceDotClass(confidence: number | undefined | null): string {
  if (confidence == null || Number.isNaN(confidence)) {
    return 'bg-on-surface-variant/40'
  }
  if (confidence >= 0.85) return 'bg-primary'
  if (confidence >= 0.6) return 'bg-amber-400/70'
  return 'bg-on-surface-variant/40'
}

/**
 * Russian label for a provenance source type.
 */
export function sourceTypeLabel(
  type: 'survey' | 'document' | 'prisma' | 'external' | 'manual' | 'missing'
): string {
  switch (type) {
    case 'survey':
      return 'Анкета'
    case 'document':
      return 'Документ'
    case 'prisma':
      return 'CRM'
    case 'external':
      return 'Внешний источник'
    case 'manual':
      return 'Вручную'
    case 'missing':
      return 'Нет данных'
  }
}
