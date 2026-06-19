/**
 * lib/assistant/validators/deterministic.ts — Layer 1 field validators.
 *
 * PURE, NO I/O. Driven entirely by SECTION_FIELD_MAP (lib/assistant/sections.ts)
 * so adding/retiring a checked field is a one-line edit there — never here.
 *
 * What it catches (mirrors validationRules in the design spec):
 *   - empty_required_field        — a required key (alias-aware) is blank
 *   - invalid_email_format        — email/url fields fail their regex
 *   - non_numeric_where_expected  — money/number/percent holds non-numeric text
 *   - negative_number             — money/number/percent < 0
 *   - percent_out_of_range        — percent field < 0 or > 100
 *   - margin_exceeds_revenue      — net_margin > 100 / net_profit > revenue
 *   - too_short_answer            — free-text required below min_len
 *   - vague_answer                — low-information heuristic on key text fields
 *   - missing_context_for_goal    — goal_12m present без metric/number attached
 *   - stale_or_conflicting_revenue— legacy s2_revenue_2024 ≠ new s9n_revenue_2024
 *
 * Every message is Russian and names the field via lib/survey-labels.ts.
 * Returns ValidationIssue[] with source:'deterministic'.
 */

import {
  SECTION_FIELD_MAP,
  fieldKeys,
  isFieldAnswered,
  type AssistantSection,
  type SurveyField,
} from '../sections'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import type { ValidationIssue } from '../types'

// ─── Value-reading helpers (alias-aware, mirrors engine coercion) ───────────

/** First non-empty raw value among a field's keys (primary + aliases). */
function firstRaw(answers: Record<string, unknown>, field: SurveyField): unknown {
  for (const k of fieldKeys(field)) {
    const v = answers[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    return v
  }
  return undefined
}

/** Russian label for a survey key (falls back to the raw key). */
function label(key: string): string {
  return SURVEY_LABELS[key] ?? key
}

/**
 * Coerce a survey value to a number the same forgiving way the engines do:
 * strip everything but digits/sign/decimal so "1 200 000 ₸" → 1200000.
 * Returns { ok, value }: ok=false means the field held text with no number.
 */
function coerceNumber(v: unknown): { ok: boolean; value: number } {
  if (typeof v === 'number') return { ok: Number.isFinite(v), value: v }
  if (typeof v === 'boolean') return { ok: false, value: 0 }
  const s = String(v ?? '').trim()
  if (s === '') return { ok: false, value: 0 }
  const cleaned = s.replace(/[^\d.,-]/g, '').replace(/,/g, '.')
  // Reject strings that carried no digit at all (e.g. "много", "—", "нет").
  if (!/\d/.test(cleaned)) return { ok: false, value: 0 }
  const n = Number(cleaned)
  return { ok: Number.isFinite(n), value: n }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i

/**
 * Low-information heuristic for vague free-text. True when the answer is made up
 * almost entirely of filler/stopwords with no nouns/numbers carrying signal —
 * e.g. "ну как бы всё нормально". Conservative: only fires on short-ish answers
 * so genuine prose is never flagged (the LLM layer can confirm borderline cases).
 */
const VAGUE_STOPWORDS = new Set([
  'это', 'как', 'бы', 'ну', 'всё', 'все', 'нормально', 'хорошо', 'разное',
  'разные', 'много', 'мало', 'есть', 'нет', 'да', 'не', 'знаю', 'не_знаю',
  'пока', 'потом', 'будет', 'надо', 'нужно', 'что', 'то', 'и', 'или', 'но',
  'просто', 'типа', 'наверное', 'может', 'возможно', 'примерно', 'около',
  'нормальный', 'обычный', 'стандартный', 'разный',
])

function isVague(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.length === 0) return false
  // Any digit is signal → not vague.
  if (/\d/.test(t)) return false
  const words = t.split(/[\s,.;:!?()«»"'\-]+/u).filter(Boolean)
  if (words.length === 0) return false
  // Long answers are assumed informative; the heuristic only guards short ones.
  if (words.length > 12) return false
  const meaningful = words.filter((w) => w.length > 2 && !VAGUE_STOPWORDS.has(w))
  // Fewer than 2 meaningful tokens across the whole answer → vague.
  return meaningful.length < 2
}

function textLength(v: unknown): number {
  return String(v ?? '').trim().length
}

// ─── Per-field checks ───────────────────────────────────────────────────────

function checkRequiredField(
  section: AssistantSection,
  field: SurveyField,
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  const answered = isFieldAnswered(answers, field)
  if (!answered) {
    issues.push({
      id: `det:${section.id}:${field.key}:empty_required`,
      severity: 'error',
      section: section.id,
      field: field.key,
      code: 'empty_required_field',
      message_ru: `Не заполнено обязательное поле «${label(field.key)}».`,
      hint_ru: 'Заполните это поле, чтобы продолжить анализ.',
      source: 'deterministic',
    })
    return
  }
  // Field is answered → run format/length checks on its value.
  checkFieldValue(section, field, answers, issues, true)
}

function checkRecommendedField(
  section: AssistantSection,
  field: SurveyField,
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  // Recommended fields are advisory: never error on emptiness, but DO validate
  // the value's format/range when the user did provide one.
  if (!isFieldAnswered(answers, field)) return
  checkFieldValue(section, field, answers, issues, false)
}

/**
 * Format/range/length validation on a field that has a value. `required` toggles
 * whether too-short text is an error-worthy gap (required) vs advisory.
 */
function checkFieldValue(
  section: AssistantSection,
  field: SurveyField,
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
  required: boolean,
): void {
  const raw = firstRaw(answers, field)
  if (raw === undefined) return

  const push = (
    code: string,
    severity: ValidationIssue['severity'],
    message_ru: string,
    hint_ru?: string,
  ) =>
    issues.push({
      id: `det:${section.id}:${field.key}:${code}`,
      severity,
      section: section.id,
      field: field.key,
      code,
      message_ru,
      hint_ru,
      source: 'deterministic',
    })

  switch (field.format) {
    case 'email': {
      if (!EMAIL_RE.test(String(raw).trim())) {
        push(
          'invalid_email_format',
          'error',
          `Поле «${label(field.key)}» не похоже на корректный email.`,
          'Проверьте формат: name@example.com',
        )
      }
      break
    }
    case 'url': {
      if (!URL_RE.test(String(raw).trim())) {
        push(
          'invalid_email_format',
          'warning',
          `Поле «${label(field.key)}» не похоже на корректный адрес сайта.`,
          'Например: https://example.com',
        )
      }
      break
    }
    case 'money':
    case 'number':
    case 'percent': {
      const { ok, value } = coerceNumber(raw)
      if (!ok) {
        push(
          'non_numeric_where_number_expected',
          'error',
          `Поле «${label(field.key)}» должно быть числом, а сейчас содержит «${String(raw).slice(0, 40)}».`,
          'Введите число без текста.',
        )
        break
      }
      if (value < 0) {
        push(
          'negative_number',
          'error',
          `Поле «${label(field.key)}» не может быть отрицательным (${value}).`,
        )
      }
      if (field.format === 'percent' && value > 100) {
        push(
          'percent_out_of_range',
          'error',
          `Поле «${label(field.key)}» — процент больше 100% (${value}%). Проверьте значение.`,
        )
      }
      break
    }
    case 'min_len':
    case 'text': {
      const minLen = field.minLen ?? 0
      const len = textLength(raw)
      if (minLen > 0 && len < minLen) {
        push(
          'too_short_answer',
          required ? 'warning' : 'info',
          `Ответ в поле «${label(field.key)}» слишком короткий.`,
          'Добавьте конкретики — это повысит качество анализа.',
        )
      } else if (typeof raw === 'string' && isVague(raw)) {
        // Only run the vague heuristic on free-text that passed the length gate.
        push(
          'vague_answer',
          required ? 'warning' : 'info',
          `Ответ в поле «${label(field.key)}» выглядит общим, без конкретики.`,
          'Укажите цифры, факты или примеры.',
        )
      }
      break
    }
    default:
      // enum / list / bool — presence already verified; no value-format check.
      break
  }
}

// ─── Cross-field deterministic checks (still pure, no rules engine) ─────────

const REVENUE_2024_PRIMARY = 's9n_revenue_2024'
const REVENUE_2024_LEGACY = 's2_revenue_2024'

/**
 * Net margin / net profit consistency. These two keys live in the same section
 * (finance) and are cheap to cross-check deterministically; the rules layer owns
 * the heavier multi-section inconsistencies.
 */
function checkFinanceConsistency(
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  const marginRaw = answers.s9n_net_margin
  if (marginRaw !== undefined && marginRaw !== null && String(marginRaw).trim() !== '') {
    const m = coerceNumber(marginRaw)
    if (m.ok && m.value > 100) {
      issues.push({
        id: 'det:finance:s9n_net_margin:margin_exceeds_revenue',
        severity: 'error',
        section: 'finance',
        field: 's9n_net_margin',
        code: 'margin_exceeds_revenue',
        message_ru: `Чистая маржа не может превышать 100% (указано ${m.value}%).`,
        hint_ru: 'Проверьте: маржа = чистая прибыль / выручка × 100%.',
        source: 'deterministic',
      })
    }
  }

  const revenue = coerceNumber(answers[REVENUE_2024_PRIMARY] ?? answers[REVENUE_2024_LEGACY])
  const profit = coerceNumber(answers.s9n_net_profit)
  if (
    revenue.ok &&
    profit.ok &&
    revenue.value > 0 &&
    profit.value > revenue.value
  ) {
    issues.push({
      id: 'det:finance:s9n_net_profit:margin_exceeds_revenue',
      severity: 'error',
      section: 'finance',
      field: 's9n_net_profit',
      code: 'margin_exceeds_revenue',
      message_ru: `Чистая прибыль (${profit.value}) больше выручки (${revenue.value}) — это невозможно.`,
      hint_ru: 'Проверьте цифры выручки и прибыли.',
      source: 'deterministic',
    })
  }
}

/** Goal stated but no measurable metric/number attached to it. */
function checkGoalContext(
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  const goal12 = String(answers.s2n_goal_12m_what ?? answers.s6_goal_12months ?? '').trim()
  if (goal12.length >= 15) {
    const metric = String(answers.s2n_goal_12m_metrics ?? '').trim()
    const goalHasNumber = /\d/.test(goal12)
    if (metric === '' && !goalHasNumber) {
      issues.push({
        id: 'det:goals:s2n_goal_12m_what:missing_context_for_goal',
        severity: 'warning',
        section: 'goals',
        field: 's2n_goal_12m_what',
        code: 'missing_context_for_goal',
        message_ru: 'Цель на 12 месяцев описана, но без измеримого показателя.',
        hint_ru: 'Добавьте метрику или число (например, выручка ₸, число клиентов).',
        source: 'deterministic',
      })
    }
  }
}

/** Legacy and new revenue keys both present but materially different. */
function checkRevenueReconciliation(
  answers: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  const newR = coerceNumber(answers[REVENUE_2024_PRIMARY])
  const legacyR = coerceNumber(answers[REVENUE_2024_LEGACY])
  if (!newR.ok || !legacyR.ok) return
  if (newR.value <= 0 || legacyR.value <= 0) return
  const bigger = Math.max(newR.value, legacyR.value)
  const smaller = Math.min(newR.value, legacyR.value)
  // "Materially" = >10% apart.
  if (bigger > 0 && (bigger - smaller) / bigger > 0.1) {
    issues.push({
      id: 'det:finance:s9n_revenue_2024:stale_or_conflicting_revenue',
      severity: 'warning',
      section: 'finance',
      field: 's9n_revenue_2024',
      code: 'stale_or_conflicting_revenue',
      message_ru: `Выручка 2024 различается в двух анкетах: ${newR.value} и ${legacyR.value}.`,
      hint_ru: 'Сверьте и оставьте одно актуальное значение.',
      source: 'deterministic',
    })
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Run all Layer-1 deterministic field validators over the curated context.
 * Pure: reads ctx.answers only, returns a fresh ValidationIssue[]. Order is
 * section-by-section then the cross-field finance/goal checks; the index layer
 * dedupes and sorts by severity.
 */
export function runDeterministicValidators(
  ctx: { answers: Record<string, unknown> },
): ValidationIssue[] {
  const answers = ctx.answers ?? {}
  const issues: ValidationIssue[] = []

  for (const section of SECTION_FIELD_MAP) {
    for (const field of section.required) {
      checkRequiredField(section, field, answers, issues)
    }
    for (const field of section.recommended) {
      checkRecommendedField(section, field, answers, issues)
    }
  }

  checkFinanceConsistency(answers, issues)
  checkGoalContext(answers, issues)
  checkRevenueReconciliation(answers, issues)

  return issues
}
