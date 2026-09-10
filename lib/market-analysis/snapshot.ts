/**
 * Snapshot builder for «Анализ рынка».
 *
 * Maps the 50-question answer set → the compact card shape consumed by
 * components/point-a/v2/MarketAnalysisCard.tsx:
 *
 *   { tam:{value,caption}, sam:{value,delta}, som:{value,caption},
 *     trendWindow:{open,caption}, mainTrend, competitorWeakness, microSegment }
 *
 * Partial data is fine — the card renders missing keys as '—'.
 *
 * DATA INTEGRITY: a field is included ONLY when its source answer is trustworthy:
 *   - status 'confirmed' (user/expert/confirmed-AI), OR
 *   - source 'ai' AND confidence >= 0.5 AND text is not «Данных недостаточно».
 * Low-confidence / insufficient-data AI drafts are excluded so the card never
 * shows fabricated or speculative market numbers.
 */

export const INSUFFICIENT_DATA = 'Данных недостаточно'
const MIN_AI_CONFIDENCE = 0.5
const MAX_VALUE_LEN = 24
const MAX_CAPTION_LEN = 60

export interface MarketAnswerRow {
  question_key: string
  answer_text: string | null
  source: 'ai' | 'user' | 'expert'
  status: 'draft' | 'confirmed' | 'disputed'
  confidence: number | null
}

// Card shape (mirror of MarketAnalysisCard's MarketSnapshot data subset).
export interface MarketSnapshotData {
  tam?: { value: string; caption: string }
  sam?: { value: string; delta: string }
  som?: { value: string; caption: string }
  trendWindow?: { open: boolean; caption: string }
  mainTrend?: string
  competitorWeakness?: string
  microSegment?: string
}

// ---------------------------------------------------------------------------
// Trust filter
// ---------------------------------------------------------------------------

/** Returns the trimmed text of an answer if it is trustworthy, else null. */
function usableText(row: MarketAnswerRow | undefined): string | null {
  if (!row) return null
  const text = (row.answer_text ?? '').trim()
  if (!text) return null
  if (text === INSUFFICIENT_DATA) return null
  if (/данных\s+недостаточно/i.test(text)) return null

  if (row.status === 'disputed') return null
  if (row.status === 'confirmed') return text

  // Remaining: status 'draft'. Only AI drafts with sufficient confidence qualify.
  if (row.source === 'ai') {
    const c = typeof row.confidence === 'number' ? row.confidence : 0
    return c >= MIN_AI_CONFIDENCE ? text : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function clamp(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Splits a numeric-ish answer into a short headline figure (value) and the
 * remaining context (caption). Best-effort: extracts the first money/number/
 * percent token as the value; otherwise the leading clause becomes the value.
 */
function splitValueCaption(text: string): { value: string; caption: string } {
  const t = text.trim()

  // Prefer an explicit figure: $2M, 1 млрд, 15%, 1 200 000 ₽, 3.5х, etc.
  const figureRe =
    /(?:[$€₽]\s?)?\d[\d\s.,]*\s*(?:%|млрд|млн|тыс\.?|трлн|руб\.?|₽|\$|€|x|х|раз|год|года|лет)?/i
  const m = t.match(figureRe)
  if (m && m[0].trim().length > 0) {
    const value = clamp(m[0], MAX_VALUE_LEN)
    const rest = (t.slice(0, m.index ?? 0) + ' ' + t.slice((m.index ?? 0) + m[0].length))
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-—:,.]+|[\s\-—:,.]+$/g, '')
      .trim()
    return { value, caption: clamp(rest, MAX_CAPTION_LEN) }
  }

  // No figure at all — the tile is a NUMBER slot. Never promote free text
  // ("Fjkdlpdpd", "не знаю") into the headline; show a dash and keep the
  // answer as the caption so the user still sees what was entered.
  return { value: '—', caption: clamp(t, MAX_CAPTION_LEN) }
}

/** First trend phrase from a comma/number-list answer (for mainTrend). */
function firstPhrase(text: string): string {
  const t = text.trim()
  // Strip a leading enumerator like "1) " / "1. " / "- ".
  const cleaned = t.replace(/^\s*(?:\d+[).]|[-–—•*])\s*/, '')
  const phrase = cleaned.split(/[\n;,.]|\s—\s|\d+[).]/)[0]?.trim() ?? cleaned
  return clamp(phrase || cleaned, MAX_CAPTION_LEN)
}

/** Detects an affirmative answer for the trend-window question (A10). */
function isAffirmative(text: string): boolean {
  return /\b(да|открыт\w*|есть|присутству\w*|имеется|true)\b/i.test(text)
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Builds the card snapshot from the user's answers. Only trustworthy answers
 * contribute fields; everything else is omitted (card shows '—').
 */
export function buildSnapshot(answers: MarketAnswerRow[]): MarketSnapshotData {
  const byKey = new Map<string, MarketAnswerRow>()
  for (const a of answers) byKey.set(a.question_key, a)

  const out: MarketSnapshotData = {}

  // TAM ← A1
  const a1 = usableText(byKey.get('A1'))
  if (a1) {
    const { value, caption } = splitValueCaption(a1)
    out.tam = { value, caption }
  }

  // SAM ← A2 (delta carries the contextual remainder)
  const a2 = usableText(byKey.get('A2'))
  if (a2) {
    const { value, caption } = splitValueCaption(a2)
    out.sam = { value, delta: caption }
  }

  // SOM ← A3
  const a3 = usableText(byKey.get('A3'))
  if (a3) {
    const { value, caption } = splitValueCaption(a3)
    out.som = { value, caption }
  }

  // Trend window ← A10 (open only if affirmative; otherwise omit entirely)
  const a10 = usableText(byKey.get('A10'))
  if (a10 && isAffirmative(a10)) {
    out.trendWindow = { open: true, caption: clamp(a10, MAX_CAPTION_LEN) }
  }

  // Main trend ← C1 (first trend phrase)
  const c1 = usableText(byKey.get('C1'))
  if (c1) out.mainTrend = firstPhrase(c1)

  // Competitor weakness ← E3 (blind spots) preferred, else E1 + weakness summary
  const e3 = usableText(byKey.get('E3'))
  const e1 = usableText(byKey.get('E1'))
  if (e3) {
    out.competitorWeakness = clamp(e3, MAX_CAPTION_LEN)
  } else if (e1) {
    out.competitorWeakness = clamp(e1, MAX_CAPTION_LEN)
  }

  // Micro-segment ×10 ← F5
  const f5 = usableText(byKey.get('F5'))
  if (f5) out.microSegment = clamp(f5, MAX_CAPTION_LEN)

  return out
}
