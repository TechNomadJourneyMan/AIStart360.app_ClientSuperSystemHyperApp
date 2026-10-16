/**
 * lib/moderation/http.ts — серверные помощники фильтра мата для API-роутов.
 *
 *   profanityResponse({ full_name, company_name }) → 400 с понятной ошибкой
 *   и именем поля, если где-то есть мат, иначе null:
 *
 *     const bad = profanityResponse({ title: body.title })
 *     if (bad) return bad
 *
 *   noProfanity — уточнение для zod-схем: z.string().superRefine(noProfanity).
 *   Сообщение ошибки — то же, что у ProfanityError.
 */

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { dirtyField, hasProfanity, ProfanityError } from './profanity'

/** Текст ошибки для формы («Уберите нецензурные слова…»). */
export const PROFANITY_MESSAGE = new ProfanityError().message

/** Произвольные значения → строки для проверки (числа, null и т.п. не проверяются). */
function textOnly(fields: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(fields)) out[k] = typeof v === 'string' ? v : null
  return out
}

/** Первое поле с матом (только строковые значения) или null. */
export function profaneField(fields: Record<string, unknown>): string | null {
  return dirtyField(textOnly(fields))
}

const NON_TEXT_KEYS = new Set(['id', 'url', 'href', 'src', 'slug', 'icon', 'cover_url', 'type', 'key', 'tone'])

/**
 * Все строковые «листья» вложенного объекта/массива → { 'blocks.0.text': '…' }.
 * Ссылки и служебные ключи (url, href, slug, id…) пропускаются.
 */
export function flattenText(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string') {
    if (prefix) out[prefix] = value
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flattenText(v, prefix ? `${prefix}.${i}` : String(i), out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NON_TEXT_KEYS.has(k)) continue
      flattenText(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
  return out
}

/** Весь текст значения одной строкой (строки внутри массивов/объектов тоже). */
export function textOf(value: unknown): string {
  // Разделитель из 3 символов: одиночные буквы соседних строк не склеиваются.
  return Object.values(flattenText(value, '_')).join(' \n ')
}

/**
 * Анкета: { question_key: значение } → 400 с ключом вопроса, где в тексте мат.
 * Числа, да/нет и пустые значения не проверяются; варианты выбора — это
 * служебные ключи, мата в них нет.
 */
export function answersProfanityResponse(answers: Record<string, unknown>): NextResponse | null {
  return profanityResponse(Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, textOf(v)])))
}

/** 400 `{ ok:false, error, field }`, если в каком-то поле мат; иначе null. */
export function profanityResponse(fields: Record<string, unknown>): NextResponse | null {
  const field = profaneField(fields)
  if (!field) return null
  return NextResponse.json(
    { ok: false, error: PROFANITY_MESSAGE, code: 'profanity', field },
    { status: 400 },
  )
}

/** zod: `z.string().superRefine(noProfanity)`. */
export function noProfanity(value: string | null | undefined, ctx: z.RefinementCtx): void {
  if (typeof value === 'string' && hasProfanity(value)) {
    ctx.addIssue({ code: 'custom', message: PROFANITY_MESSAGE, params: { profanity: true } })
  }
}
