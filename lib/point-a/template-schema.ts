/**
 * lib/point-a/template-schema.ts — validation of an industry template of
 * Point A edited in GIGA-CRM (pa_templates). No server imports: the
 * constructor page reuses the rules for its live preview.
 */
import { z } from 'zod'
import { BLOCK_KEYS } from './v4/config'

export const TEMPLATE_KEY_RE = /^[a-z0-9_-]{2,40}$/

const TemplateBlock = z.object({
  key: z.enum(BLOCK_KEYS),
  weight: z.number({ invalid_type_error: 'Вес — число' }).min(0, 'Вес блока от 0 до 1').max(1, 'Вес блока от 0 до 1'),
  enabled: z.boolean(),
})

const ContentBase = z.object({
  title: z.string().trim().min(2, 'Название — от 2 символов').max(80, 'Название — до 80 символов'),
  industries: z
    .array(z.string().trim().toLowerCase().min(2, 'Отрасль — от 2 символов').max(40, 'Отрасль — до 40 символов'))
    .max(20, 'Не больше 20 отраслей')
    .default([])
    .transform((xs) => [...new Set(xs)]),
  blocks: z.array(TemplateBlock).length(BLOCK_KEYS.length, 'Нужны все 7 блоков'),
})

function checkBlocks(t: { blocks: Array<{ key: string; weight: number; enabled: boolean }> }, ctx: z.RefinementCtx): void {
  const keys = new Set(t.blocks.map((b) => b.key))
  if (keys.size !== BLOCK_KEYS.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Каждый из 7 блоков — ровно один раз', path: ['blocks'] })
  if (!t.blocks.some((b) => b.enabled && b.weight > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Включите хотя бы один блок с весом больше 0', path: ['blocks'] })
}

export const TemplateContent = ContentBase.superRefine(checkBlocks)

export const TemplateCreate = ContentBase.extend({
  key: z.string().trim().regex(TEMPLATE_KEY_RE, 'Ключ: 2–40 символов, латиница в нижнем регистре, цифры, «-» и «_»'),
}).superRefine(checkBlocks)

export type TemplateInput = z.infer<typeof TemplateContent>

/** Blocks in the library order (the stored JSON keeps that order). */
export function orderedBlocks(blocks: TemplateInput['blocks']): TemplateInput['blocks'] {
  return BLOCK_KEYS.map((k) => blocks.find((b) => b.key === k)!).filter(Boolean)
}
