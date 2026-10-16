/**
 * lib/comm/kb.ts — the knowledge base of the client bot (kb_articles, 120).
 *
 *   validation      title 1–300, body ≤ 100 000, ≤ 20 tags; profanity in the
 *                   title / body / tags is refused with the field named
 *                   (ProfanityError → 400 in the GIGA routes);
 *   files           txt / md as text, pdf / docx through the platform document
 *                   parser (lib/documents/parse.ts) → a draft article;
 *   embeddings      a published article gets an embedding (vector(1536)) from
 *                   the project's embedding provider (embedWithOpenRouter —
 *                   OpenRouter or a configured provider). Editing the text
 *                   clears it and publishing computes it again. Without a
 *                   provider the article stays without one;
 *   search          match_kb_articles (122) over published articles with an
 *                   embedding; no vector / no RPC / no hits → keyword ranking
 *                   over the published articles (lib/comm/bot-rules.ts).
 *
 * Server only (service role). Drafts are never shown to the bot.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { dirtyField, ProfanityError } from '@/lib/moderation/profanity'
import { rankKbByKeywords, type KbHit } from './bot-rules'

export const KB_COLUMNS = 'id, title, body, tags, source, status, updated_by, created_at, updated_at'
export const KB_MAX_BODY = 100_000
export const KB_MAX_FILE_BYTES = 5 * 1024 * 1024
export const KB_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'pdf', 'docx'] as const
const EMBED_CHARS = 8_000
/** Keyword fallback reads at most this many published articles. */
const KEYWORD_POOL = 200

export interface KbArticleRow {
  id: string
  title: string
  body: string
  tags: string[]
  source: 'manual' | 'file'
  status: 'draft' | 'published'
  updated_by: string | null
  created_at: string
  updated_at: string
}

export const KbArticleInput = z.object({
  title: z.string().trim().min(1, 'Введите заголовок').max(300, 'Заголовок длиннее 300 символов'),
  body: z.string().max(KB_MAX_BODY, `Текст длиннее ${KB_MAX_BODY} символов`).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
})
export type KbArticleInput = z.infer<typeof KbArticleInput>

export const KbArticlePatch = KbArticleInput.partial()
export type KbArticlePatch = z.infer<typeof KbArticlePatch>

export function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))).slice(0, 20)
}

/** Throws ProfanityError(field) for a dirty title / body / tag. */
export function assertCleanArticle(fields: { title?: string | null; body?: string | null; tags?: string[] | null }): void {
  const field = dirtyField({ title: fields.title ?? null, body: fields.body ?? null, tags: (fields.tags ?? []).join(' ') || null })
  if (field) throw new ProfanityError(field)
}

/** Text the embedding is computed from. */
export function articleEmbeddingText(a: Pick<KbArticleRow, 'title' | 'body' | 'tags'>): string {
  return [a.title, (a.tags ?? []).join(', '), a.body].filter(Boolean).join('\n\n').slice(0, EMBED_CHARS)
}

/** pgvector literal '[0.1,0.2,…]'. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => (Number.isFinite(n) ? n.toFixed(6) : '0')).join(',')}]`
}

export type Embedder = (text: string) => Promise<number[] | null>

/** The project's embedding provider; null when none is configured or the call failed. */
export const defaultEmbedder: Embedder = async (text) => {
  try {
    const { embedWithOpenRouter } = await import('@/lib/ai/openrouter')
    const v = await embedWithOpenRouter([text], { feature: 'kb_embed', dimensions: 1536 })
    const vec = v?.[0]
    return Array.isArray(vec) && vec.length === 1536 ? vec : null
  } catch {
    return null
  }
}

/** Compute and store the embedding of an article; false — no provider / failure (keyword search still works). */
export async function embedArticle(sb: SupabaseClient, article: Pick<KbArticleRow, 'id' | 'title' | 'body' | 'tags'>, embed: Embedder = defaultEmbedder): Promise<boolean> {
  const vec = await embed(articleEmbeddingText(article))
  if (!vec) return false
  const { error } = await sb.from('kb_articles').update({ embedding: toVectorLiteral(vec) }).eq('id', article.id)
  if (error) {
    console.error('[comm/kb] embedding save failed', error.message?.slice(0, 120))
    return false
  }
  return true
}

/** Ids of the given articles that have an embedding. */
export async function embeddedIds(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data } = await sb.from('kb_articles').select('id').in('id', ids).not('embedding', 'is', null)
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}

/**
 * Published articles for a question: semantic (match_kb_articles) when an
 * embedding of the question can be computed, else / additionally by words.
 */
export async function searchKnowledge(
  sb: SupabaseClient,
  query: string,
  opts: { embed?: Embedder; limit?: number } = {},
): Promise<{ hits: KbHit[]; mode: 'semantic' | 'keyword' | 'none' }> {
  const limit = opts.limit ?? 4
  const q = query.trim().slice(0, 2_000)
  if (!q) return { hits: [], mode: 'none' }

  const vec = await (opts.embed ?? defaultEmbedder)(q).catch(() => null)
  if (vec) {
    const { data, error } = await sb.rpc('match_kb_articles', { p_query: toVectorLiteral(vec), p_limit: limit, p_min_similarity: 0.3 })
    if (!error && Array.isArray(data) && data.length) {
      return {
        mode: 'semantic',
        hits: (data as Array<{ id: string; title: string; body: string; tags: string[] | null; similarity: number }>).map((r) => ({
          id: r.id, title: r.title, body: r.body, tags: r.tags, similarity: r.similarity,
        })),
      }
    }
  }

  const { data } = await sb
    .from('kb_articles')
    .select('id, title, body, tags')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(KEYWORD_POOL)
  const hits = rankKbByKeywords(q, ((data ?? []) as KbHit[]), limit)
  return { hits, mode: hits.length ? 'keyword' : 'none' }
}

// ─── Files ──────────────────────────────────────────────────────────────────

export class KbFileError extends Error {}

export function kbFileExtension(name: string): string {
  return (name.toLowerCase().split('.').pop() ?? '').trim()
}

/** Title from a file name: «Цены и тарифы.docx» → «Цены и тарифы». */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base || 'Статья из файла').slice(0, 300)
}

/** Plain text of an uploaded file (txt / md / pdf / docx). */
export async function parseKbFile(buffer: Buffer, fileName: string, mimeType?: string): Promise<string> {
  const ext = kbFileExtension(fileName)
  if (!(KB_FILE_EXTENSIONS as readonly string[]).includes(ext)) throw new KbFileError('Поддерживаются файлы .txt, .md, .pdf и .docx')
  if (buffer.length > KB_MAX_FILE_BYTES) throw new KbFileError('Файл больше 5 МБ')
  let text: string
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    const { decodeText } = await import('@/lib/documents/preflight')
    text = decodeText(buffer)?.text ?? buffer.toString('utf-8')
  } else {
    const { parseDocument } = await import('@/lib/documents/parse')
    try {
      text = (await parseDocument(buffer, fileName, mimeType)).text
    } catch {
      throw new KbFileError('Не удалось прочитать файл — проверьте, что он не повреждён и не защищён паролем')
    }
  }
  const clean = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (!clean) throw new KbFileError('В файле нет текста (скан без распознавания?) — вставьте текст вручную')
  return clean.slice(0, KB_MAX_BODY)
}

// ─── GIGA «База знаний бота» ────────────────────────────────────────────────

export const KB_LIST_COLUMNS = 'id, title, tags, source, status, updated_by, created_at, updated_at'

export interface KbArticleDTO {
  id: string
  title: string
  /** Only in the single-article view. */
  body?: string
  tags: string[]
  source: 'manual' | 'file'
  status: 'draft' | 'published'
  /** Has an embedding: the bot finds it by meaning, not only by words. */
  semantic: boolean
  updatedAt: string
  createdAt: string
}

export function kbDTO(row: Omit<KbArticleRow, 'body'> & { body?: string }, semantic: boolean, withBody = false): KbArticleDTO {
  return {
    id: row.id, title: row.title, ...(withBody ? { body: row.body ?? '' } : {}), tags: row.tags ?? [], source: row.source,
    status: row.status, semantic, updatedAt: row.updated_at, createdAt: row.created_at,
  }
}

/** A ProfanityError as the 400 body of the GIGA routes ({ error, field }). */
export function profanityResponseBody(err: ProfanityError): { ok: false; error: string; field: string | null } {
  return { ok: false, error: err.message, field: err.field }
}
