/**
 * lib/comm/store.ts — reads and writes of comm_threads / comm_messages
 * (service role; every caller passes the client so tests use an in-memory one).
 *
 * Short queries only — no transactions held open, no loops over users.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MESSAGE_COLUMNS, THREAD_COLUMNS,
  type CommChannel, type CommMessageRow, type CommRecipient, type CommThreadMode, type CommThreadRow,
} from './types'
import type { ThreadPatch } from './state'

export class CommError extends Error {
  constructor(message: string, public code: 'not_found' | 'invalid' | 'blocked' | 'db') {
    super(message)
  }
}

function dbError(op: string, error: { message?: string; code?: string } | null): CommError {
  return new CommError(`${op}: ${error?.code ?? ''} ${error?.message?.slice(0, 200) ?? 'database error'}`.trim(), 'db')
}

export async function findThreadByUser(sb: SupabaseClient, userId: string): Promise<CommThreadRow | null> {
  const { data, error } = await sb.from('comm_threads').select(THREAD_COLUMNS).eq('user_id', userId).maybeSingle()
  if (error) throw dbError('read thread', error)
  return (data as CommThreadRow | null) ?? null
}

export async function findThreadById(sb: SupabaseClient, threadId: string): Promise<CommThreadRow | null> {
  const { data, error } = await sb.from('comm_threads').select(THREAD_COLUMNS).eq('id', threadId).maybeSingle()
  if (error) throw dbError('read thread', error)
  return (data as CommThreadRow | null) ?? null
}

/** The user's conversation; created on first use (one per user, unique user_id). */
export async function ensureThread(sb: SupabaseClient, userId: string, opts: { defaultMode?: CommThreadMode } = {}): Promise<CommThreadRow> {
  const existing = await findThreadByUser(sb, userId)
  if (existing) return existing

  const { data: company } = await sb.from('companies').select('id').eq('user_id', userId).limit(1).maybeSingle()
  const { data, error } = await sb
    .from('comm_threads')
    .insert({ user_id: userId, company_id: (company as { id?: string } | null)?.id ?? null, mode: opts.defaultMode ?? 'manual', status: 'open' })
    .select(THREAD_COLUMNS)
    .maybeSingle()
  if (error) {
    // A concurrent first message created it a moment ago.
    if ((error as { code?: string }).code === '23505') {
      const again = await findThreadByUser(sb, userId)
      if (again) return again
    }
    throw dbError('create thread', error)
  }
  if (!data) throw new CommError('create thread: no row returned', 'db')
  return data as CommThreadRow
}

export async function updateThread(sb: SupabaseClient, threadId: string, patch: ThreadPatch | Record<string, unknown>): Promise<void> {
  const { error } = await sb.from('comm_threads').update(patch).eq('id', threadId)
  if (error) throw dbError('update thread', error)
}

export async function loadRecipient(sb: SupabaseClient, userId: string): Promise<CommRecipient | null> {
  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, email, phone, telegram_chat_id, preferences')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw dbError('read profile', error)
  const p = data as { id: string; full_name: string | null; email: string | null; phone: string | null; telegram_chat_id: string | null; preferences: unknown } | null
  if (!p) return null
  return {
    id: p.id,
    fullName: p.full_name?.trim() || null,
    email: p.email?.trim() || null,
    phone: p.phone?.trim() || null,
    telegramChatId: p.telegram_chat_id ? String(p.telegram_chat_id) : null,
    preferences: p.preferences ?? null,
  }
}

/**
 * An explicit WhatsApp opt-out the client made in the notification settings
 * (whatsapp_links, migration 104). A read error counts as «not opted out»:
 * the thread flag (comm_threads.whatsapp_opt_out_at) is the primary switch.
 */
export async function whatsappLinkOptedOut(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('whatsapp_links')
      .select('opt_in_at, opt_out_at')
      .eq('user_id', userId)
      .eq('recipient_kind', 'client')
      .maybeSingle()
    if (error || !data) return false
    const row = data as { opt_in_at: string | null; opt_out_at: string | null }
    if (!row.opt_out_at) return false
    return !row.opt_in_at || new Date(row.opt_out_at) > new Date(row.opt_in_at)
  } catch {
    return false
  }
}

export async function lastInboundChannel(sb: SupabaseClient, threadId: string): Promise<CommChannel | null> {
  const { data } = await sb
    .from('comm_messages')
    .select('channel')
    .eq('thread_id', threadId)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data as { channel?: CommChannel } | null)?.channel) ?? null
}

export type NewMessage = Omit<CommMessageRow, 'id' | 'created_at' | 'sent_at' | 'metadata' | 'campaign_id' | 'reply_to_id' | 'external_id' | 'error' | 'subject' | 'author_id' | 'author_name' | 'body_masked' | 'flags'> & {
  body_masked?: string | null
  flags?: CommMessageRow['flags']
  metadata?: Record<string, unknown>
  campaign_id?: string | null
  reply_to_id?: string | null
  external_id?: string | null
  error?: string | null
  subject?: string | null
  author_id?: string | null
  author_name?: string | null
  created_at?: string
  sent_at?: string | null
}

/** Insert messages; `duplicate` when an inbound (channel, external_id) already exists. */
export async function insertMessages(sb: SupabaseClient, rows: NewMessage[]): Promise<{ rows: CommMessageRow[]; duplicate: boolean }> {
  const { data, error } = await sb.from('comm_messages').insert(rows).select(MESSAGE_COLUMNS)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { rows: [], duplicate: true }
    throw dbError('insert message', error)
  }
  return { rows: (data ?? []) as CommMessageRow[], duplicate: false }
}

export async function updateMessage(sb: SupabaseClient, id: string, patch: Partial<Pick<CommMessageRow, 'status' | 'error' | 'external_id' | 'sent_at' | 'metadata'>>): Promise<void> {
  const { error } = await sb.from('comm_messages').update(patch).eq('id', id)
  if (error) console.error('[comm] message status update failed', error.code ?? '', error.message?.slice(0, 120))
}

export async function listMessages(sb: SupabaseClient, threadId: string, limit = 200): Promise<CommMessageRow[]> {
  const { data, error } = await sb
    .from('comm_messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw dbError('read messages', error)
  return ((data ?? []) as CommMessageRow[]).reverse()
}
