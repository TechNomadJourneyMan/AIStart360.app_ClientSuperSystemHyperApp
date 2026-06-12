/**
 * Server-side persistence helpers for «Анализ рынка».
 *
 * All operations run through the session-scoped Supabase client; RLS
 * (owner = auth.uid()) confines every read/write to the current user, so no
 * service-role key is needed here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSnapshot, type MarketAnswerRow } from './snapshot'
import { getQuestion } from './questions'

/** Columns we read for an answer (kept tight). */
const ANSWER_SELECT =
  'question_key, block, answer_text, source, status, confidence, model, updated_at'

export interface AnswerRecord {
  question_key: string
  block: string
  answer_text: string | null
  source: 'ai' | 'user' | 'expert'
  status: 'draft' | 'confirmed' | 'disputed'
  confidence: number | null
  model: string | null
  updated_at: string | null
}

/** Loads all of the user's market-analysis answers. */
export async function loadAnswers(
  sb: SupabaseClient,
  userId: string,
): Promise<AnswerRecord[]> {
  const { data, error } = await sb
    .from('market_analysis_answers')
    .select(ANSWER_SELECT)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as AnswerRecord[]
}

/** Loads the latest snapshot row's `data`, or null. */
export async function loadLatestSnapshot(
  sb: SupabaseClient,
  userId: string,
): Promise<unknown | null> {
  const { data } = await sb
    .from('market_snapshots')
    .select('data, computed_at')
    .eq('user_id', userId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.data ?? null
}

/**
 * Rebuilds the snapshot from the user's current answers and inserts a new
 * market_snapshots row (history is kept; the card reads the latest).
 * Best-effort: never throws — failures are logged and swallowed so a mutation
 * is not rolled back just because the derived snapshot insert failed.
 */
export async function rebuildSnapshot(
  sb: SupabaseClient,
  userId: string,
  niche?: string | null,
): Promise<void> {
  try {
    const rows = await loadAnswers(sb, userId)
    const answerRows: MarketAnswerRow[] = rows.map((r) => ({
      question_key: r.question_key,
      answer_text: r.answer_text,
      source: r.source,
      status: r.status,
      confidence: r.confidence,
    }))
    const data = buildSnapshot(answerRows)
    const { error } = await sb.from('market_snapshots').insert({
      user_id: userId,
      niche: niche ?? null,
      data,
    })
    if (error) console.error('[market-analysis] snapshot insert failed', error.message)
  } catch (err) {
    console.error('[market-analysis] rebuildSnapshot failed', err)
  }
}

/**
 * Upserts a single answer (target: unique (user_id, question_key)).
 * `block` is derived from the registry to keep the column consistent.
 */
export async function upsertAnswer(
  sb: SupabaseClient,
  userId: string,
  input: {
    question_key: string
    answer_text: string | null
    source: 'ai' | 'user' | 'expert'
    status: 'draft' | 'confirmed' | 'disputed'
    confidence?: number | null
    model?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const q = getQuestion(input.question_key)
  if (!q) return { ok: false, error: 'unknown_question_key' }

  const { error } = await sb
    .from('market_analysis_answers')
    .upsert(
      {
        user_id: userId,
        question_key: input.question_key,
        block: q.block,
        answer_text: input.answer_text,
        source: input.source,
        status: input.status,
        confidence: input.confidence ?? null,
        model: input.model ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,question_key' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
