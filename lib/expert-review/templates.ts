/**
 * lib/expert-review/templates.ts — библиотека шаблонов эксперта (F-031 / E12).
 *
 * Шаблон привязан к блоку разбора (`expert_templates.block` — ключ из
 * REVIEW_BLOCKS, «Общее» = 'general'). Универсальные шаблоны («Общее»)
 * предлагаются в любом блоке.
 */

import { z } from 'zod'
import { isReviewBlockKey, type ReviewBlockKey } from './blocks'

export const TEMPLATE_COLUMNS = 'id, block, title, body, created_by, is_shared, created_at, updated_at'

export const templateBodySchema = z.object({
  block: z.string().refine(isReviewBlockKey, 'Неизвестный блок'),
  title: z.string().trim().min(1, 'Название пустое').max(200),
  body: z.string().trim().min(1, 'Текст шаблона пустой').max(5000),
  is_shared: z.boolean().optional(),
})

export const templatePatchSchema = templateBodySchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Нечего сохранять')

/** Какие блоки показывать в выборе шаблона для блока `block`. */
export function templateBlockFilter(block: ReviewBlockKey | string): string[] {
  return block === 'general' ? ['general'] : [block, 'general']
}
