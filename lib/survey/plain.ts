/**
 * lib/survey/plain.ts — questionnaire answers for readers that want TEXT, not the editor's Markdown
 * (W5: survey_answers.answer.value may hold `**жирный**`, `- пункт`, `[текст](url)`).
 *
 *   plainAnswer(v)      a string → stripMarkdown (the words stay, the markup goes), a file reference → «Файл: name»;
 *                       an array of strings → each;
 *                       anything else as is (numbers, booleans, table rows)
 *   plainAnswers(map)   the same over a question_key → value map
 *
 * Used by the exports (Google Sheets, the Telegram «анкета заполнена», PDF / the shared report through
 * formatSurveyValue), GIGA / cabinet plain views and the AI prompt contexts. NOT used where an answer is edited
 * (the questionnaire, GIGA «Анкета» edit) — the editor needs the raw value.
 */
import { stripMarkdown } from './markdown'
import { surveyFileLabel } from '@/lib/documents/survey-files'

export function plainAnswer(v: unknown): unknown {
  // A file answer (step 6 scripts: `<bucket>/<path>` or a legacy Storage URL) → «Файл: name»,
  // so no storage path / URL reaches exports or AI prompts.
  if (typeof v === 'string') return surveyFileLabel(v) ?? stripMarkdown(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map((x) => stripMarkdown(x as string))
  return v
}

export function plainAnswers(map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(map)) out[k] = plainAnswer(v)
  return out
}
