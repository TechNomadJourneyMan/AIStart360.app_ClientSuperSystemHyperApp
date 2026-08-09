// Shared formatters for the analytics screen.
// Amounts are deliberately printed WITHOUT a currency sign: the underlying
// field is `pulse_metrics.avg_check` and the database stores no currency, so
// printing "$" (as the previous version did) was inventing information.

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

/** Compact amount for tiles and table cells: 1,2 млн / 340 тыс. / 820 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${nf1.format(value / 1_000_000)} млн`
  if (abs >= 10_000) return `${nf0.format(value / 1000)} тыс.`
  return nf0.format(value)
}

/** Full amount, digit for digit — used inside the drill-down and in CSV. */
export function formatAmountFull(value: number): string {
  return Number.isFinite(value) ? nf0.format(Math.round(value)) : '—'
}

export function formatNumber(value: number): string {
  return nf0.format(value)
}

export function formatScore(value: number | null): string {
  return value === null ? '—' : nf0.format(value)
}

export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${nf1.format(value)}%`
}

export function formatPercent(value: number): string {
  return `${nf1.format(value)}%`
}

export function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso))
}

export function formatDateFull(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso))
}

/** Server-rendered only — otherwise the timezone would differ between render passes. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Russian plural: pluralRu(2, 'отчёт', 'отчёта', 'отчётов') → 'отчёта' */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return many
  if (n1 > 1 && n1 < 5) return few
  if (n1 === 1) return one
  return many
}

/** GRI score comes from the DB as 0..100 and is shown as 0..1000. */
export function toDisplayGri(raw: number): number {
  return Math.round(raw * 10)
}

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: 'Активные',
  at_risk: 'В зоне риска',
  inactive: 'Неактивные',
  onboarding: 'Онбординг',
}

export const PERFORMANCE_STATUS_LABELS: Record<string, string> = {
  Strong: 'Сильный',
  Active: 'Активный',
  Developing: 'Развивается',
  Critical: 'Критично',
}
