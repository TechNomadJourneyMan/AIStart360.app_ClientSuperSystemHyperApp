/**
 * lib/expert-review/blocks.ts — блоки экспертного разбора.
 *
 * Разбор эксперта складывается по 10 блокам: 7 блоков GRI + Точка А + Точка Б
 * + «Общее». Ключ блока хранится в `expert_comments.block_key`; «Общее» — это
 * NULL (как у старых комментариев общей ленты). Старые ключи из
 * lib/comment-targets.ts продолжают читаться — они показываются по своей
 * подписи и группе.
 *
 * Модуль чистый (без сервера) — его используют и API, и UI.
 */

import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import type { SectionId } from '@/lib/gri-assessment/sections'
import { GROUP_LABEL, getTarget, targetLabel } from '@/lib/comment-targets'

export const GRI_SECTION_IDS: readonly SectionId[] = [
  'product-demand',
  'trust-positioning',
  'business-model',
  'cash-stability',
  'operations',
  'team',
  'owner-readiness',
]

export type ReviewBlockKey = 'general' | 'point-a' | 'point-b' | `gri:${SectionId}`

export interface ReviewBlock {
  key: ReviewBlockKey
  label: string
}

export const REVIEW_BLOCKS: readonly ReviewBlock[] = [
  { key: 'general', label: 'Общее' },
  { key: 'point-a', label: 'Точка А' },
  { key: 'point-b', label: 'Точка Б' },
  ...GRI_SECTION_IDS.map((id) => ({ key: `gri:${id}` as ReviewBlockKey, label: `GRI · ${GRI_BLOCK_RU[id]}` })),
]

const BLOCK_BY_KEY = new Map<string, ReviewBlock>(REVIEW_BLOCKS.map((b) => [b.key, b]))

export function isReviewBlockKey(v: unknown): v is ReviewBlockKey {
  return typeof v === 'string' && BLOCK_BY_KEY.has(v)
}

/** Ключ блока → значение `block_key` в БД («Общее» = NULL). */
export function toStoredBlockKey(key: ReviewBlockKey): string | null {
  return key === 'general' ? null : key
}

/** `block_key` из БД → ключ блока (NULL → 'general'; старые ключи — как есть). */
export function fromStoredBlockKey(stored: string | null | undefined): string {
  return stored ? stored : 'general'
}

/** Подпись блока — и для новых ключей, и для старых из comment-targets. */
export function reviewBlockLabel(stored: string | null | undefined): string {
  const key = fromStoredBlockKey(stored)
  const known = BLOCK_BY_KEY.get(key)
  if (known) return known.label
  const target = getTarget(key)
  if (!target) return 'Общее'
  if (target.group === 'general') return targetLabel(key)
  return `${GROUP_LABEL[target.group]} · ${target.label}`
}

/** Порядок блоков: известные — по REVIEW_BLOCKS, прочие — в конце. */
export function reviewBlockOrder(stored: string | null | undefined): number {
  const i = REVIEW_BLOCKS.findIndex((b) => b.key === fromStoredBlockKey(stored))
  return i === -1 ? REVIEW_BLOCKS.length : i
}

/** Подпись автора для клиента, когда имени в профиле нет. */
export const DEFAULT_EXPERT_NAME = 'Эксперт AIStart360'

/**
 * Имя автора, которое видит клиент: ФИО из профиля, иначе «Эксперт AIStart360».
 * Email не показывается никогда — даже если он оказался в поле имени.
 */
export function expertDisplayName(fullName: string | null | undefined): string {
  const n = (fullName ?? '').trim()
  if (!n || n.includes('@')) return DEFAULT_EXPERT_NAME
  return n.slice(0, 120)
}
