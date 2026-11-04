import type {
  NormalizedPointAValue,
  PointAPeriod,
  PointAScenario,
  PointAValueType,
} from './types'

const EMPTY_PERIOD: PointAPeriod = {
  key: '',
  start: null,
  end: null,
  year: null,
  quarter: null,
  month: null,
}

const SCALE_PATTERNS: Array<[RegExp, number]> = [
  [/(?<!\p{L})(?:млрд|миллиард(?:а|ов)?|billion|bn|b)(?![\p{L}\d])/iu, 1_000_000_000],
  [/(?<!\p{L})(?:млн|миллион(?:а|ов)?|million|mn|m|м)(?![\p{L}\d])/iu, 1_000_000],
  [/(?<!\p{L})(?:тыс|тысяч(?:а|и)?|thousand|k|к)(?![\p{L}\d])/iu, 1_000],
]

function inferCurrency(text: string, explicit?: string | null): string | null {
  if (explicit?.trim()) {
    const requested = explicit.trim()
    if (/₸|тенге|тг|^kzt$/iu.test(requested)) return 'KZT'
    if (/\$|^usd$/iu.test(requested)) return 'USD'
    if (/€|^eur$/iu.test(requested)) return 'EUR'
    if (/₽|руб|^rub$/iu.test(requested)) return 'RUB'
    const code = requested.toUpperCase()
    return /^[A-Z]{3}$/.test(code) ? code : null
  }

  const probe = text.trim()
  if (/₸|тенге|тг|\bkzt\b/iu.test(probe)) return 'KZT'
  if (/\$|\busd\b/iu.test(probe)) return 'USD'
  if (/€|\beur\b/iu.test(probe)) return 'EUR'
  if (/₽|\brub\b|руб/iu.test(probe)) return 'RUB'
  return null
}

function normalizeNumericPunctuation(input: string): string {
  const sign = input.startsWith('-') ? '-' : input.startsWith('+') ? '+' : ''
  const unsigned = sign ? input.slice(1) : input
  const comma = unsigned.lastIndexOf(',')
  const dot = unsigned.lastIndexOf('.')
  const separator = Math.max(comma, dot)

  if (separator < 0) return sign + unsigned.replace(/[.,]/g, '')

  const separatorChar = unsigned[separator]
  const hasBothSeparators = comma >= 0 && dot >= 0

  // A lone separator followed by exactly three digits is normally a grouping
  // separator in business reports ("1,234", "2.500"). Multiple equal
  // separators are also grouping when every group after the first has 3 digits.
  const groups = unsigned.split(separatorChar)
  const groupedThousands =
    !hasBothSeparators &&
    groups.length > 1 &&
    groups.slice(1).every((group) => /^\d{3}$/.test(group))

  if (groupedThousands) {
    return sign + unsigned.replace(/[.,]/g, '')
  }

  const integer = unsigned.slice(0, separator).replace(/[.,]/g, '')
  const fraction = unsigned.slice(separator + 1).replace(/[.,]/g, '')
  return `${sign}${integer || '0'}${fraction ? `.${fraction}` : ''}`
}

function parseNumeric(raw: unknown, unitHint?: string | null): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const input = raw.trim()
  if (!input) return null
  const multiplier =
    SCALE_PATTERNS.find(([pattern]) => pattern.test(input))?.[1] ?? 1
  const isParenthesized = /^\s*\(.*\)\s*$/.test(input)

  const compact = input
    .replace(/\u00a0|\u202f|\s/gu, '')
    .replace(/[()]/g, '')
    .replace(/[^\d.,+-]/g, '')

  if (!compact || compact === '-' || compact === '+') return null
  if (!/^[+-]?[\d.,]+$/.test(compact)) return null
  const parsed = Number(normalizeNumericPunctuation(compact))
  if (!Number.isFinite(parsed)) return null
  const scaled = parsed * multiplier
  const value = isParenthesized ? -Math.abs(scaled) : scaled

  // Percentages are stored as percentage points (52.3, not 0.523), which is
  // consistent with survey and metric registry semantics.
  if (unitHint === '%' || /%/.test(input)) return value
  return value
}

function inferScenario(
  explicit: PointAScenario | undefined,
  context: string,
): PointAScenario {
  if (explicit) return explicit
  if (/прогноз|forecast|projection/iu.test(context)) return 'forecast'
  if (/план|budget|target/iu.test(context)) return 'plan'
  return 'fact'
}

function inferPeriodFromContext(context: string): string | null {
  return context.match(
    /(?<!\d)20\d{2}(?:[-/.](?:Q[1-4]|0?[1-9]|1[0-2]))?(?!\d)/iu,
  )?.[0] ?? null
}

function validDateString(value: string): string | null {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return null
  return new Date(ts).toISOString().slice(0, 10)
}

export function buildPointAPeriod(input?: {
  period?: string | null
  year?: number | null
  quarter?: PointAPeriod['quarter']
  month?: number | null
  start?: string | null
  end?: string | null
}): PointAPeriod {
  if (!input) return { ...EMPTY_PERIOD }
  let year = Number.isInteger(input.year) ? Number(input.year) : null
  let month =
    Number.isInteger(input.month) && Number(input.month) >= 1 && Number(input.month) <= 12
      ? Number(input.month)
      : null
  let quarter = input.quarter ?? null

  const period = input.period?.trim() ?? ''
  const monthMatch = period.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/)
  const quarterMatch = period.match(/\b(20\d{2})[- ]?Q([1-4])\b/i)
  const yearMatch = period.match(/\b(20\d{2})\b/)
  if (monthMatch) {
    year = Number(monthMatch[1])
    month = Number(monthMatch[2])
  } else if (quarterMatch) {
    year = Number(quarterMatch[1])
    quarter = `Q${quarterMatch[2]}` as PointAPeriod['quarter']
  } else if (yearMatch && year === null) {
    year = Number(yearMatch[1])
  }

  if (month) {
    quarter = `Q${Math.ceil(month / 3)}` as PointAPeriod['quarter']
  }

  const start = input.start ? validDateString(input.start) : null
  const end = input.end ? validDateString(input.end) : null
  const key = start || end
    ? `${start ?? ''}/${end ?? ''}`
    : year && month
      ? `${year}-${String(month).padStart(2, '0')}`
      : year && quarter
        ? `${year}-${quarter}`
        : year
          ? String(year)
          : period

  return { key, start, end, year, quarter, month }
}

function inferValueType(raw: unknown, numeric: number | null): PointAValueType {
  if (numeric !== null) return 'number'
  if (typeof raw === 'boolean') return 'boolean'
  if (Array.isArray(raw)) return 'list'
  if (raw !== null && typeof raw === 'object') return 'object'
  if (typeof raw === 'string' && validDateString(raw)) return 'date'
  return 'text'
}

export function normalizePointAValue(
  rawValue: unknown,
  hints: {
    unit?: string | null
    currency?: string | null
    period?: string | null
    periodYear?: number | null
    periodQuarter?: PointAPeriod['quarter']
    periodMonth?: number | null
    periodStart?: string | null
    periodEnd?: string | null
    scenario?: PointAScenario
    context?: string
  } = {},
): NormalizedPointAValue {
  const context = `${hints.context ?? ''} ${String(rawValue ?? '')}`
  const unit =
    hints.unit?.trim() ||
    (/%/.test(context) ? '%' : null)
  const numeric = parseNumeric(rawValue, unit)
  const valueType = inferValueType(rawValue, numeric)
  const normalizedValue =
    numeric !== null
      ? numeric
      : valueType === 'date' && typeof rawValue === 'string'
        ? validDateString(rawValue)
        : typeof rawValue === 'string'
          ? rawValue.trim()
          : rawValue
  const currency = inferCurrency(`${context} ${unit ?? ''}`, hints.currency)
  const period = buildPointAPeriod({
    period: hints.period ?? inferPeriodFromContext(hints.context ?? ''),
    year: hints.periodYear,
    quarter: hints.periodQuarter,
    month: hints.periodMonth,
    start: hints.periodStart,
    end: hints.periodEnd,
  })
  const scenario = inferScenario(hints.scenario, context)

  return {
    rawValue,
    normalizedValue,
    valueType,
    unit,
    currency,
    period,
    scenario,
    validForAggregation:
      valueType === 'number' &&
      typeof normalizedValue === 'number' &&
      Number.isFinite(normalizedValue),
  }
}

export function normalizedValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(1, Math.abs(a), Math.abs(b))
    return Math.abs(a - b) <= scale * 0.0001
  }
  return stableJson(a) === stableJson(b)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
