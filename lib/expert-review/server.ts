/**
 * lib/expert-review/server.ts — серверные помощники экспертного разбора.
 *
 * Все чтения/записи идут через service-role клиент (панель авторизует сама —
 * requireGiga), поэтому каждый запрос явно фильтрует по клиенту и статусу.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { expertDisplayName } from './blocks'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const COMMENT_COLUMNS =
  'id, client_id, author_id, author_title, block_key, text, status, source, ai_flags, review_id, published_at, created_at, updated_at'

export const REVIEW_COLUMNS = 'id, user_id, author_id, status, title, summary, published_at, created_at, updated_at'

export interface ReviewRow {
  id: string
  user_id: string
  author_id: string | null
  status: 'draft' | 'published'
  title: string | null
  summary: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface CommentRow {
  id: string
  client_id: string
  author_id: string
  author_title: string | null
  block_key: string | null
  text: string
  status: 'draft' | 'published'
  source: 'expert' | 'ai'
  ai_flags: Array<{ category: string; severity: string; note: string }> | null
  review_id: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

type Sb = Pick<SupabaseClient, 'from'>

/** Текущий черновик разбора клиента (или null). */
export async function findDraftReview(sb: Sb, userId: string): Promise<ReviewRow | null> {
  const { data } = await sb
    .from('expert_reviews')
    .select(REVIEW_COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'draft')
    .maybeSingle()
  return (data as ReviewRow | null) ?? null
}

/**
 * Черновик разбора клиента: существующий или новый. Уникальный индекс
 * «один черновик на клиента» закрывает гонку двух экспертов — проигравший
 * вставку просто перечитывает черновик победителя.
 */
export async function ensureDraftReview(sb: Sb, userId: string, authorId: string): Promise<ReviewRow> {
  const existing = await findDraftReview(sb, userId)
  if (existing) return existing
  const { data, error } = await sb
    .from('expert_reviews')
    .insert({ user_id: userId, author_id: authorId, status: 'draft' })
    .select(REVIEW_COLUMNS)
    .single()
  if (data) return data as ReviewRow
  const again = await findDraftReview(sb, userId)
  if (again) return again
  throw new Error(error?.message ?? 'Не удалось создать черновик разбора')
}

/** Черновые комментарии клиента (всех экспертов). */
export async function listDraftComments(sb: Sb, userId: string): Promise<CommentRow[]> {
  const { data } = await sb
    .from('expert_comments')
    .select(COMMENT_COLUMNS)
    .eq('client_id', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: true })
  return (data as CommentRow[] | null) ?? []
}

/**
 * Отображаемые имена авторов: ФИО из профиля либо «Эксперт AIStart360».
 * Email в выдачу не попадает никогда.
 */
export async function authorNames(sb: Sb, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x && UUID_RE.test(x))))
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await sb.from('profiles').select('id, full_name').in('id', unique)
  for (const p of (data as Array<{ id: string; full_name: string | null }> | null) ?? []) {
    out.set(p.id, expertDisplayName(p.full_name))
  }
  for (const id of unique) if (!out.has(id)) out.set(id, expertDisplayName(null))
  return out
}

/** Отображаемое имя одного сотрудника. */
export async function displayNameOf(sb: Sb, id: string): Promise<string> {
  return (await authorNames(sb, [id])).get(id) ?? expertDisplayName(null)
}
