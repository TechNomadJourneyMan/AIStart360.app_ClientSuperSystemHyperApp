/**
 * lib/documents/question-link.ts — files attached to a questionnaire question
 * from the answer editor (PO item 4.1; documents.question_key, migration 131).
 *
 * The file itself goes through the normal upload pipeline (private bucket →
 * POST /api/v1/documents → preflight, dedupe, parsing / OCR); the link is one
 * column on the document row. Every function is scoped to the owner
 * (`user_id`) and tolerant of a database without migration 131: the upload
 * still succeeds, the list is empty.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumnError } from '@/lib/survey/attribution'
import { CLIENT_DOCUMENT_COLUMNS, parsedDataForList, type ClientDocument } from './status-view'

export const QUESTION_KEY_RE = /^[a-z][a-z0-9_]{1,79}$/

export function isQuestionKey(v: unknown): v is string {
  return typeof v === 'string' && QUESTION_KEY_RE.test(v)
}

export type LinkResult = 'linked' | 'skipped' | 'unavailable' | 'error'

/**
 * Attach a document to a question. `onlyIfUnlinked` (a duplicate upload of a
 * file the user already had): a file attached to another question stays there.
 */
export async function linkDocumentToQuestion(
  client: Pick<SupabaseClient, 'from'>,
  input: { documentId: string; userId: string; questionKey: string; onlyIfUnlinked?: boolean },
): Promise<LinkResult> {
  if (!isQuestionKey(input.questionKey)) return 'skipped'
  try {
    let q = client.from('documents').update({ question_key: input.questionKey }).eq('id', input.documentId).eq('user_id', input.userId)
    if (input.onlyIfUnlinked) q = q.is('question_key', null)
    const { error } = await q
    if (!error) return 'linked'
    if (isMissingColumnError(error)) {
      console.warn('[documents/question-link] documents.question_key missing (migration 131 not applied?) — file kept unattached')
      return 'unavailable'
    }
    console.error('[documents/question-link] link failed', (error as { code?: string }).code ?? error)
    return 'error'
  } catch (err) {
    console.error('[documents/question-link] link failed', err instanceof Error ? err.message : err)
    return 'error'
  }
}

/** Detach (the document itself stays in «Мои документы»). */
export async function unlinkDocumentFromQuestion(
  client: Pick<SupabaseClient, 'from'>,
  input: { documentId: string; userId: string; questionKey: string },
): Promise<LinkResult> {
  if (!isQuestionKey(input.questionKey)) return 'skipped'
  try {
    const { error } = await client
      .from('documents')
      .update({ question_key: null })
      .eq('id', input.documentId)
      .eq('user_id', input.userId)
      .eq('question_key', input.questionKey)
    if (!error) return 'linked'
    return isMissingColumnError(error) ? 'unavailable' : 'error'
  } catch {
    return 'error'
  }
}

/** The owner's documents attached to a question, newest first. */
export async function listQuestionDocuments(
  client: Pick<SupabaseClient, 'from'>,
  input: { userId: string; questionKey: string; limit?: number },
): Promise<{ ok: true; documents: ClientDocument[]; available: boolean } | { ok: false }> {
  if (!isQuestionKey(input.questionKey)) return { ok: true, documents: [], available: true }
  const { data, error } = await client
    .from('documents')
    .select(CLIENT_DOCUMENT_COLUMNS)
    .eq('user_id', input.userId)
    .eq('question_key', input.questionKey)
    .order('uploaded_at', { ascending: false })
    .limit(input.limit ?? 50)
  if (error) return isMissingColumnError(error) ? { ok: true, documents: [], available: false } : { ok: false }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return {
    ok: true,
    available: true,
    documents: rows.map((r) => ({ ...r, parsed_data: parsedDataForList(r.parsed_data) }) as ClientDocument),
  }
}
