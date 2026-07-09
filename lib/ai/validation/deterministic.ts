/**
 * lib/ai/validation/deterministic.ts — the always-on, zero-latency intake layer.
 *
 * Runs on every AI answer before it reaches the user (see
 * docs/SPEC-2026-07-09-AI-FEATURES/08-validation-layer.md §1 step 6). It is
 * cheap, deterministic and fully unit-tested, so it can gate answers without an
 * LLM call: it redacts secrets, catches forbidden claims (guarantees,
 * diagnoses, prompt leaks), flags high-risk topics for cautious mode, checks
 * that cited sources were actually provided, and does a conservative
 * number-grounding pass. The heavier LLM validator (llm-validator.ts) runs on
 * top of this for chat and high-risk answers.
 *
 * Pure module: only depends on the existing output filter.
 */

import { filterModelOutput } from '@/lib/assistant/mascot/output-filter'

export type IssueCategory =
  | 'factuality'
  | 'grounding'
  | 'hallucination'
  | 'overconfidence'
  | 'financial_risk'
  | 'legal_risk'
  | 'medical_risk'
  | 'psychological_risk'
  | 'security'
  | 'privacy'
  | 'pii'
  | 'manipulation'
  | 'unsafe_recommendation'
  | 'prompt_injection'
  | 'data_leakage'

export type Severity = 'info' | 'warning' | 'error'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface DeterministicIssue {
  category: IssueCategory
  severity: Severity
  note: string
  evidence?: string
}

export interface DeterministicInput {
  /** The model's draft answer. */
  answer: string
  /** Sources the model claims it used (their `ref`s). */
  usedSources?: Array<{ ref: string }>
  /** Sources actually placed in the prompt context (their `ref`s). */
  providedSources?: string[]
  /** Numbers present in the grounding context, for number-grounding. */
  contextNumbers?: number[]
}

export interface DeterministicResult {
  /** Answer after secret/markup redaction — safe to persist/return. */
  cleanedAnswer: string
  issues: DeterministicIssue[]
  riskLevel: RiskLevel
}

// ── Forbidden claims (always errors) ─────────────────────────────────────────

// NOTE: JS `\w`/`\b` are ASCII-only and do NOT match Cyrillic. All keyword
// patterns therefore use the `u` flag with `\p{L}` for word chars and explicit
// non-letter lookarounds for boundaries.

const GUARANTEE_PATTERNS: RegExp[] = [
  /гаранти\p{L}*/iu, // гарантия, гарантирую, гарантированно
  /100\s*%\s*(?:результат|успех|прибыл)\p{L}*/iu,
  /(?:точно|обязательно|наверняка|100%)\s+(?:вырастет|заработаете|окупит|удвоит)\p{L}*/iu,
]

const DIAGNOSIS_PATTERNS: RegExp[] = [
  /диагноз\p{L}*/iu,
  /диагностиру\p{L}*/iu,
  /у вас\s+(?:депресс|выгоран|тревожн|расстройств|сдвг|биполя)\p{L}*/iu,
]

const PROMPT_LEAK_PATTERNS: RegExp[] = [
  /систем\p{L}*\s+(?:промпт|инструкц)\p{L}*/iu,
  /(?:мои|мой|моя)\s+(?:систем\p{L}*\s+)?инструкц\p{L}*/iu,
  /я\s+(?:получил|следую|обязан следовать)\s+инструкц\p{L}*/iu,
]

// ── High-risk topics (cautious mode — warnings, not blocks) ───────────────────

const RISK_TOPICS: Array<{ category: IssueCategory; re: RegExp; note: string }> = [
  { category: 'financial_risk', re: /(?<!\p{L})(?:кредит|инвестиц|налог|ипотек|заём|займ)\p{L}*/iu, note: 'Финансовая тема — нужен осторожный режим и дисклеймер' },
  // `суд`/`иск` matched as whole words so «судя», «искать» don't false-positive.
  { category: 'legal_risk', re: /(?<!\p{L})(?:суд(?!\p{L})|судебн\p{L}*|иск(?!\p{L})|исков\p{L}*|неустойк\p{L}*|подать в суд)/iu, note: 'Юридическая тема — рекомендовать профильного специалиста' },
  { category: 'medical_risk', re: /(?<!\p{L})(?:лечен|симптом|дозиров|препарат|болезн)\p{L}*/iu, note: 'Медицинская тема — вне компетенции, направить к специалисту' },
]

// ── Manipulation ─────────────────────────────────────────────────────────────

const MANIPULATION_PATTERNS: RegExp[] = [
  /теряете деньги каждый день/iu,
  /действуйте прямо сейчас,?\s*иначе/iu,
  /все успешные (?:уже|давно)/iu,
  /(?:всё|все) пропал\p{L}*/iu,
  /если не сделаете это (?:сегодня|сейчас)/iu,
]

// ── Number grounding ─────────────────────────────────────────────────────────

const CALC_MARKER = /(?:расч[её]т\w*|примерно|около|≈|~|прибли[зж]\w*|оцен\w* в)/i
const NUMBER_TOKEN = /\d[\d\s.,]*\d|\d/g
const SIGNIFICANT = 1000

function parseNumberToken(token: string): number {
  // Group separators in RU are spaces; drop them, keep a single decimal dot.
  const cleaned = token.replace(/\s/g, '').replace(/,/g, '.')
  const dots = cleaned.split('.').length - 1
  const normalized = dots > 1 ? cleaned.replace(/\./g, '') : cleaned
  return Number(normalized)
}

function isGrounded(n: number, context: number[]): boolean {
  return context.some((c) => {
    if (c === n) return true
    const tol = Math.max(Math.abs(c) * 0.005, 0.5) // 0.5% relative tolerance
    return Math.abs(c - n) <= tol
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function runDeterministicChecks(input: DeterministicInput): DeterministicResult {
  const issues: DeterministicIssue[] = []

  // 1. Secret / markup redaction (reuse the existing output filter).
  const filtered = filterModelOutput(input.answer ?? '')
  const cleanedAnswer = filtered.text
  if (filtered.redacted) {
    issues.push({
      category: 'data_leakage',
      severity: 'error',
      note: 'В ответе обнаружены секреты или разметка — отредактировано',
    })
  }

  // 2. Forbidden claims.
  for (const re of GUARANTEE_PATTERNS) {
    const m = cleanedAnswer.match(re)
    if (m) issues.push({ category: 'unsafe_recommendation', severity: 'error', note: 'Недопустимая гарантия результата', evidence: m[0] })
  }
  for (const re of DIAGNOSIS_PATTERNS) {
    const m = cleanedAnswer.match(re)
    if (m) issues.push({ category: 'psychological_risk', severity: 'error', note: 'Недопустимый психологический/медицинский диагноз', evidence: m[0] })
  }
  for (const re of PROMPT_LEAK_PATTERNS) {
    const m = cleanedAnswer.match(re)
    if (m) issues.push({ category: 'security', severity: 'error', note: 'Ответ раскрывает системные инструкции', evidence: m[0] })
  }

  // 3. High-risk topics → cautious mode.
  for (const t of RISK_TOPICS) {
    const m = cleanedAnswer.match(t.re)
    if (m) issues.push({ category: t.category, severity: 'warning', note: t.note, evidence: m[0] })
  }

  // 4. Manipulation.
  for (const re of MANIPULATION_PATTERNS) {
    const m = cleanedAnswer.match(re)
    if (m) issues.push({ category: 'manipulation', severity: 'warning', note: 'Манипулятивная формулировка (давление/срочность/стыд)', evidence: m[0] })
  }

  // 5. Source check — every cited source must have been provided.
  if (input.usedSources && input.providedSources) {
    const provided = new Set(input.providedSources)
    for (const s of input.usedSources) {
      if (!provided.has(s.ref)) {
        issues.push({ category: 'grounding', severity: 'warning', note: 'Цитируется источник, которого не было в контексте', evidence: s.ref })
      }
    }
  }

  // 6. Number grounding — conservative: only significant numbers, and skipped
  // entirely when the answer explicitly frames itself as an estimate.
  if (input.contextNumbers && input.contextNumbers.length > 0 && !CALC_MARKER.test(cleanedAnswer)) {
    const seen = new Set<number>()
    for (const token of cleanedAnswer.match(NUMBER_TOKEN) ?? []) {
      const n = parseNumberToken(token)
      if (!Number.isFinite(n) || Math.abs(n) < SIGNIFICANT || seen.has(n)) continue
      seen.add(n)
      if (!isGrounded(n, input.contextNumbers)) {
        issues.push({ category: 'hallucination', severity: 'warning', note: 'Число отсутствует в данных и не помечено как расчёт', evidence: token.trim() })
      }
    }
  }

  return { cleanedAnswer, issues, riskLevel: aggregateRisk(issues) }
}

const MEDIUM_BUMP: ReadonlySet<IssueCategory> = new Set<IssueCategory>([
  'financial_risk', 'legal_risk', 'medical_risk', 'hallucination', 'manipulation', 'overconfidence',
])

function aggregateRisk(issues: DeterministicIssue[]): RiskLevel {
  if (issues.some((i) => i.severity === 'error')) return 'high'
  if (issues.some((i) => MEDIUM_BUMP.has(i.category))) return 'medium'
  return 'low'
}
