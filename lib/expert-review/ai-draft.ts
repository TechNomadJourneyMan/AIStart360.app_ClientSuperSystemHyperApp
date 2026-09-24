/**
 * lib/expert-review/ai-draft.ts — ИИ-черновик экспертного разбора (F-074 / E13).
 *
 * Собирает контекст клиента (анкета, Точка А, GRI, Точка Б), формирует промпт,
 * разбирает JSON-ответ модели и прогоняет каждый текст через
 * lib/ai/validation. Результат — только ЧЕРНОВИКИ: публикует их эксперт.
 *
 * Модуль чистый (без БД и сети) — маршрут подаёт сюда уже прочитанные строки,
 * поэтому вся логика покрыта юнит-тестами.
 */

import { answersFromRows } from '@/lib/survey/export'
import type { SurveyStepRow } from '@/lib/survey/steps'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import { runAnswerValidation } from '@/lib/ai/validation'
import type { DeterministicIssue } from '@/lib/ai/validation/deterministic'
import { GRI_SECTION_IDS, REVIEW_BLOCKS, isReviewBlockKey, type ReviewBlockKey } from './blocks'

export interface ReviewContextInput {
  surveyRows: ReadonlyArray<SurveyStepRow>
  diagnostic: Record<string, unknown> | null
  gri: { gri_index?: unknown; section_avgs?: unknown; top_5_limits?: unknown; created_at?: unknown } | null
  pointB: { target_overall?: unknown; target_health?: unknown; target_stage?: unknown } | null
  expertPointB: { expert_notes?: unknown } | null
}

export interface ReviewContext {
  text: string
  /** Чего не хватает — модель не должна это выдумывать, эксперт видит список. */
  missing: string[]
  /** Числа из контекста — для проверки «число есть в данных». */
  numbers: number[]
  /** Есть ли вообще, о чём писать. */
  hasData: boolean
}

const MAX_SURVEY_CHARS = 9000
const MAX_VALUE_CHARS = 400

function short(v: unknown, max = MAX_VALUE_CHARS): string {
  let s: string
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') s = v
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
  else {
    try {
      s = JSON.stringify(v)
    } catch {
      return ''
    }
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const POINT_A_BLOCKS: Array<[string, string]> = [
  ['finance_score', 'Финансы'],
  ['sales_score', 'Продажи'],
  ['marketing_score', 'Маркетинг'],
  ['operations_score', 'Операции'],
  ['strategy_score', 'Стратегия'],
]

export function buildReviewContext(input: ReviewContextInput): ReviewContext {
  const parts: string[] = []
  const missing: string[] = []

  // ── Анкета ────────────────────────────────────────────────────────────────
  const answers = answersFromRows(input.surveyRows)
  const lines: string[] = []
  let used = 0
  for (const [k, v] of Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))) {
    const s = short(v)
    if (!s) continue
    const line = `- ${k}: ${s}`
    if (used + line.length > MAX_SURVEY_CHARS) break
    used += line.length
    lines.push(line)
  }
  if (lines.length) parts.push(`## Анкета клиента (ключ: ответ)\n${lines.join('\n')}`)
  else missing.push('Анкета клиента не заполнена')

  // ── Точка А ───────────────────────────────────────────────────────────────
  const d = input.diagnostic
  if (d) {
    const rows: string[] = []
    const overall = num(d.overall_score)
    if (overall !== null) rows.push(`- Общий балл: ${overall} из 100`)
    const health = num(d.health_index)
    if (health !== null) rows.push(`- Индекс здоровья: ${health}`)
    if (d.stage) rows.push(`- Стадия: ${short(d.stage, 60)}`)
    for (const [col, label] of POINT_A_BLOCKS) {
      const b = d[col] as { score?: unknown; top_issues?: unknown } | null | undefined
      const score = num(b?.score)
      if (score === null) continue
      const issues = Array.isArray(b?.top_issues) ? b!.top_issues.slice(0, 3).map((x) => short(x, 160)).filter(Boolean) : []
      rows.push(`- ${label}: ${score}${issues.length ? ` (проблемы: ${issues.join('; ')})` : ''}`)
    }
    const gaps = Array.isArray(d.data_gaps) ? d.data_gaps.slice(0, 8).map((x) => short(x, 160)).filter(Boolean) : []
    if (gaps.length) rows.push(`- Пробелы в данных: ${gaps.join('; ')}`)
    if (rows.length) parts.push(`## Точка А (диагностика)\n${rows.join('\n')}`)
    else missing.push('Точка А рассчитана без показателей')
  } else {
    missing.push('Точка А не рассчитана')
  }

  // ── GRI ───────────────────────────────────────────────────────────────────
  const g = input.gri
  const griIndex = num(g?.gri_index)
  if (g && griIndex !== null) {
    const rows: string[] = [`- Индекс GRI: ${griIndex} из 10`]
    const avgs = (g.section_avgs && typeof g.section_avgs === 'object' ? g.section_avgs : {}) as Record<string, unknown>
    for (const id of GRI_SECTION_IDS) {
      const v = num(avgs[id])
      rows.push(`- Блок «${GRI_BLOCK_RU[id]}» (gri:${id}): ${v === null ? 'нет оценки' : `${v} из 10`}`)
    }
    const limits = Array.isArray(g.top_5_limits) ? g.top_5_limits : []
    const lim = limits
      .slice(0, 5)
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>
        const text = short(o.criterionText ?? o.title ?? o.label, 200)
        if (!text) return null
        const s = num(o.score)
        return `- ${text}${o.blockName ? ` [${short(o.blockName, 60)}]` : ''}${s !== null ? ` — ${s} из 10` : ''}`
      })
      .filter(Boolean)
    if (lim.length) rows.push(`Топ-5 ограничений роста:\n${lim.join('\n')}`)
    parts.push(`## GRI (индекс готовности к росту)\n${rows.join('\n')}`)
  } else {
    missing.push('GRI-оценка не пройдена')
  }

  // ── Точка Б ───────────────────────────────────────────────────────────────
  const pb = input.pointB
  const pbRows: string[] = []
  if (pb) {
    const to = num(pb.target_overall)
    if (to !== null) pbRows.push(`- Целевой общий балл: ${to}`)
    const th = num(pb.target_health)
    if (th !== null) pbRows.push(`- Целевой индекс здоровья: ${th}`)
    if (pb.target_stage) pbRows.push(`- Целевая стадия: ${short(pb.target_stage, 60)}`)
  }
  const notes = short(input.expertPointB?.expert_notes, 1500)
  if (notes) pbRows.push(`- Заметки эксперта к Точке Б: ${notes}`)
  if (pbRows.length) parts.push(`## Точка Б (цель)\n${pbRows.join('\n')}`)
  else missing.push('Точка Б не рассчитана')

  const text = parts.join('\n\n')
  const numbers = Array.from(new Set((text.match(/\d[\d\s.,]*\d|\d/g) ?? []).map((t) => Number(t.replace(/\s/g, '').replace(/,/g, '.'))).filter(Number.isFinite)))
  return { text, missing, numbers, hasData: parts.length > 0 }
}

const BLOCK_LIST = REVIEW_BLOCKS.map((b) => `"${b.key}" — ${b.label}`).join('\n')

export const REVIEW_AI_SYSTEM = `Ты — опытный бизнес-эксперт AIStart360. Готовишь ЧЕРНОВИК разбора бизнеса клиента для эксперта-человека: он прочитает, поправит и только потом отправит клиенту.

Правила:
- Пиши по-русски, обращайся к клиенту на «вы», деловым спокойным тоном.
- Опирайся ТОЛЬКО на данные из контекста. Не придумывай чисел, фактов, названий. Любое число в тексте должно быть в контексте.
- Если данных для блока нет — прямо напиши, чего не хватает и что клиенту стоит заполнить, вместо выводов.
- Никаких гарантий результата, юридических, налоговых и медицинских заключений.
- На каждый блок — не больше одного комментария, 2–5 предложений: наблюдение → почему это важно → конкретный следующий шаг.
- Пропускай блоки, о которых нечего сказать.

Допустимые блоки (поле "block"):
${BLOCK_LIST}

Ответ — строго JSON без пояснений:
{"comments":[{"block":"<ключ блока>","text":"<текст комментария>"}]}`

export function buildReviewAiUser(ctx: ReviewContext): string {
  const missing = ctx.missing.length ? `\n\n## Чего нет в данных\n${ctx.missing.map((m) => `- ${m}`).join('\n')}` : ''
  return `Данные клиента:\n\n${ctx.text || '(данных нет)'}${missing}\n\nПодготовь черновик разбора по блокам.`
}

export interface AiDraftItem {
  block: ReviewBlockKey
  text: string
}

/** Разбор ответа модели: только известные блоки, по одному на блок, 1..5000 символов. */
export function parseAiDraft(raw: unknown): AiDraftItem[] {
  const list = (raw && typeof raw === 'object' ? (raw as { comments?: unknown }).comments : null) ?? []
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: AiDraftItem[] = []
  for (const item of list) {
    const o = (item ?? {}) as { block?: unknown; text?: unknown }
    if (!isReviewBlockKey(o.block) || seen.has(o.block)) continue
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 5000) : ''
    if (!text) continue
    seen.add(o.block)
    out.push({ block: o.block, text })
  }
  return out.slice(0, REVIEW_BLOCKS.length)
}

export interface ValidatedDraftItem extends AiDraftItem {
  /** Замечания валидатора (warning/error) — эксперт видит их у комментария. */
  flags: Array<Pick<DeterministicIssue, 'category' | 'severity' | 'note'>> | null
}

/**
 * Прогон каждого текста через lib/ai/validation.
 *  blocked         → комментарий отбрасывается (утечка, инструкции, диагнозы);
 *  needs_revision  → сохраняется очищенный текст с пометкой-ошибкой: публикация
 *                    не пройдёт, пока эксперт его не поправит;
 *  approved        → сохраняется, предупреждения — пометками.
 */
export async function validateDraftItems(
  items: AiDraftItem[],
  contextNumbers: number[],
): Promise<{ kept: ValidatedDraftItem[]; dropped: Array<{ block: ReviewBlockKey; reason: string }> }> {
  const kept: ValidatedDraftItem[] = []
  const dropped: Array<{ block: ReviewBlockKey; reason: string }> = []
  for (const it of items) {
    const v = await runAnswerValidation({ answer: it.text, contextNumbers })
    if (v.status === 'blocked') {
      dropped.push({ block: it.block, reason: v.issues.find((i) => i.severity === 'error')?.note ?? 'Отклонено валидатором' })
      continue
    }
    const text = v.cleanedAnswer.trim()
    if (!text) {
      dropped.push({ block: it.block, reason: 'Пустой текст после проверки' })
      continue
    }
    const flags = v.issues
      .filter((i) => i.severity !== 'info')
      .map((i) => ({ category: i.category, severity: i.severity, note: i.note }))
    kept.push({ block: it.block, text, flags: flags.length ? flags : null })
  }
  return { kept, dropped }
}

/** Есть ли у комментария пометка-ошибка валидатора (такой разбор не публикуем). */
export function hasBlockingFlag(flags: unknown): boolean {
  return Array.isArray(flags) && flags.some((f) => (f as { severity?: string })?.severity === 'error')
}
