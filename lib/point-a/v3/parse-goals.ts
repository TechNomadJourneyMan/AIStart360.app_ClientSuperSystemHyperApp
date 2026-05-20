// ============================================================
// lib/point-a/v3/parse-goals.ts
//
// Extract numeric revenue targets (₸ KZT) from the free-text
// survey goal answers `s6_goal_12months` / `s6_goal_3years`.
//
// The owner writes things like:
//   • "$2M ARR к концу 2026"
//   • "200 млн ₸"
//   • "вырасти до 5 миллиардов тенге за 3 года"
//   • "1 500 000 000 KZT"
//   • "300k USD MRR"
//
// We greedily extract the first plausible monetary amount,
// detect the currency and unit-magnitude (тыс / млн / млрд / k / M / B),
// and convert to ₸ at a fixed FX rate (USD/RUB → KZT).
//
// This is intentionally NOT an AI call — it's a deterministic
// regex parser. The compute engine (top-table.ts) falls back
// to AI extraction only when this returns confidence === 0.
// ============================================================

export const FX_RATE_USD_KZT = 450 // $1 = 450 ₸ (project constant per spec)
export const FX_RATE_RUB_KZT = 5.5 // ₽1 ≈ 5.5 ₸ (rough — owner usually states ₸)
export const FX_RATE_EUR_KZT = 490
export const FX_RATE_KZT_KZT = 1

type Currency = 'KZT' | 'USD' | 'RUB' | 'EUR'

interface ParsedAmount {
  value: number
  currency: Currency
  unit: string | null
  matchText: string
  confidence: number
}

export interface ParsedGoals {
  /** Extracted 12-month revenue target in ₸ (KZT). null = couldn't parse. */
  revenue_12m_kzt: number | null
  /** Extracted 3-year revenue target in ₸ (KZT). null = couldn't parse. */
  revenue_3y_kzt: number | null
  /** Combined confidence 0..1 — average of the two underlying parses; 0 if both failed. */
  confidence: number
  /** Per-field diagnostics for debugging / observability. */
  details: {
    goal_12m: { raw: string | null; parsed: ParsedAmount | null }
    goal_3y: { raw: string | null; parsed: ParsedAmount | null }
  }
}

// ─── Currency detection ──────────────────────────────────────

const CURRENCY_PATTERNS: Array<{ re: RegExp; currency: Currency }> = [
  { re: /(₸|тенге|тг\b|kzt|казахстанск)/i, currency: 'KZT' },
  { re: /(\$|usd|долл|dollars?)/i, currency: 'USD' },
  { re: /(₽|руб|rub|рубл)/i, currency: 'RUB' },
  { re: /(€|eur|евро)/i, currency: 'EUR' },
]

function detectCurrency(text: string): Currency {
  for (const { re, currency } of CURRENCY_PATTERNS) {
    if (re.test(text)) return currency
  }
  // Owner is Kazakh — default to ₸ when ambiguous.
  return 'KZT'
}

// ─── Magnitude detection ─────────────────────────────────────

// Maps a unit token to its numeric multiplier.
// Note: JS regex `\b` is ASCII-only — it would treat Cyrillic letters as
// non-word characters and silently fail to match Russian magnitude tokens.
// We use Unicode-aware lookarounds instead.
const MAGNITUDES: Array<{ re: RegExp; mult: number; label: string }> = [
  {
    re: /(?<![\p{L}])(?:млрд|bn|billion|миллиард(?:а|ов)?)(?![\p{L}])/iu,
    mult: 1_000_000_000,
    label: 'млрд',
  },
  {
    re: /(?<![\p{L}])(?:млн|mln|million|миллион(?:а|ов)?)(?![\p{L}])|(?<=\d)\s*M(?![\p{L}])/iu,
    mult: 1_000_000,
    label: 'млн',
  },
  {
    re: /(?<![\p{L}])(?:тыс|k|thousand|тысяч(?:а|и)?)(?![\p{L}])|(?<=\d)\s*K(?![\p{L}])/iu,
    mult: 1_000,
    label: 'тыс',
  },
]

function detectMagnitude(text: string): { mult: number; label: string | null } {
  for (const m of MAGNITUDES) {
    if (m.re.test(text)) return { mult: m.mult, label: m.label }
  }
  return { mult: 1, label: null }
}

// ─── Number extraction ───────────────────────────────────────

/**
 * Pull the first plausible number out of free-form text. Handles:
 *   1 500 000   (space thousands)
 *   1,500,000   (comma thousands)
 *   2.5         (decimal)
 *   2,5         (european decimal)
 *
 * Disambiguation rule: if the token contains BOTH commas and spaces,
 * commas are thousands. If it contains ONLY a comma followed by ≤2
 * digits and nothing else, comma is a decimal separator.
 */
function extractFirstNumber(text: string): { value: number; matchText: string } | null {
  // Match a number that may have group separators (space, comma, dot) and
  // an optional decimal tail.
  const re = /-?\d{1,3}(?:[\s.,]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/
  const m = text.match(re)
  if (!m) return null
  const raw = m[0]

  // Decide thousands vs decimal separator.
  const hasSpace = /\d\s\d/.test(raw)
  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')

  let normalized = raw.replace(/\s/g, '')

  if (hasSpace && (hasComma || hasDot)) {
    // Space groups thousands; the remaining comma/dot is the decimal.
    normalized = normalized.replace(/,/g, '.')
    // If we have multiple dots, only the last is the decimal.
    const parts = normalized.split('.')
    if (parts.length > 2) {
      normalized = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
    }
  } else if (hasComma && hasDot) {
    // Both present, no spaces → the LAST one wins as decimal.
    const lastComma = normalized.lastIndexOf(',')
    const lastDot = normalized.lastIndexOf('.')
    if (lastDot > lastComma) {
      // dot is decimal, comma is thousands
      normalized = normalized.replace(/,/g, '')
    } else {
      // comma is decimal, dot is thousands
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    }
  } else if (hasComma) {
    // Only commas. If pattern is "\d{1,3},\d{1,2}$" treat as decimal,
    // otherwise as thousands separator.
    const onlyDecimalComma = /^-?\d{1,3},\d{1,2}$/.test(normalized)
    normalized = onlyDecimalComma ? normalized.replace(',', '.') : normalized.replace(/,/g, '')
  }
  // dot-only is left as-is — JS parseFloat handles it.

  const value = parseFloat(normalized)
  if (!Number.isFinite(value)) return null
  return { value, matchText: raw }
}

// ─── Main parser ─────────────────────────────────────────────

function fxToKzt(amount: number, currency: Currency): number {
  switch (currency) {
    case 'KZT': return amount * FX_RATE_KZT_KZT
    case 'USD': return amount * FX_RATE_USD_KZT
    case 'RUB': return amount * FX_RATE_RUB_KZT
    case 'EUR': return amount * FX_RATE_EUR_KZT
  }
}

/**
 * Parse a single free-text goal string into a numeric KZT amount.
 * Returns null when the string clearly isn't a monetary target
 * (e.g. "увеличить количество клиентов до 5000" — no currency).
 *
 * Confidence heuristic:
 *   +0.4 has a recognisable number
 *   +0.3 has a currency token
 *   +0.2 has a magnitude token (млн / млрд / k / M)
 *   +0.1 mentions revenue/доход/выручка/ARR/оборот
 *   cap at 1.0
 */
export function parseGoalAmount(text: string | null | undefined): ParsedAmount | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const num = extractFirstNumber(trimmed)
  if (!num) return null

  // Heuristic: a bare "5000 клиентов" with no currency and no revenue word
  // is a CLIENT-COUNT goal, not a revenue goal. Reject.
  const hasCurrency = CURRENCY_PATTERNS.some((p) => p.re.test(trimmed))
  const mentionsRevenue = /(выруч|доход|оборот|revenue|sales|продаж|arr|mrr|gmv|turnover)/i.test(trimmed)
  const mentionsClientCount = /(клиент|пациент|customer|users?|пользоват)/i.test(trimmed)

  if (!hasCurrency && !mentionsRevenue && mentionsClientCount) {
    return null
  }

  const currency = detectCurrency(trimmed)
  const mag = detectMagnitude(trimmed)

  // Bare number with no currency / magnitude / revenue keyword =
  // not a monetary target. Without at least one of these signals
  // we have nothing to anchor the conversion on (e.g. "стать №1").
  if (!hasCurrency && !mag.label && !mentionsRevenue) {
    return null
  }

  const baseAmount = num.value * mag.mult
  if (baseAmount <= 0) return null

  let confidence = 0.4 // we found a number
  if (hasCurrency) confidence += 0.3
  if (mag.label) confidence += 0.2
  if (mentionsRevenue) confidence += 0.1
  confidence = Math.min(1, Math.round(confidence * 100) / 100)

  return {
    value: Math.round(fxToKzt(baseAmount, currency)),
    currency,
    unit: mag.label,
    matchText: num.matchText,
    confidence,
  }
}

/**
 * Parse both 12-month and 3-year goal strings into a ParsedGoals
 * payload ready to write to `companies.target_revenue_*_kzt`.
 *
 * Never throws — returns null targets when parsing fails so the
 * caller can decide whether to skip the upsert.
 */
export function parseGoals(
  goal12m: string | null | undefined,
  goal3y: string | null | undefined,
): ParsedGoals {
  const p12 = parseGoalAmount(goal12m ?? null)
  const p3y = parseGoalAmount(goal3y ?? null)

  const confidences = [p12?.confidence ?? 0, p3y?.confidence ?? 0].filter((c) => c > 0)
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0

  return {
    revenue_12m_kzt: p12?.value ?? null,
    revenue_3y_kzt: p3y?.value ?? null,
    confidence,
    details: {
      goal_12m: { raw: goal12m ?? null, parsed: p12 },
      goal_3y: { raw: goal3y ?? null, parsed: p3y },
    },
  }
}
