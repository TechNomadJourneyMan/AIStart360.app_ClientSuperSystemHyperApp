/**
 * In-memory double of the service-role Supabase client for lib/comm tests:
 * the query-builder subset lib/comm uses, generated ids / timestamps, the
 * unique rules of migration 120 (one thread per user, inbound
 * (channel, external_id)) and rpc('comm_user_by_phone') over profiles.phone.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { phoneKey } from '@/lib/comm/phone'
import type { CommTransports } from '@/lib/comm/transports'

export type Row = Record<string, unknown>

const THREAD_DEFAULTS: Row = {
  company_id: null, assignee_id: null, status: 'open', mode: 'manual', last_inbound_at: null, last_outbound_at: null,
  last_message_at: null, last_message_preview: null, staff_reply_due_at: null, escalated_at: null, unread_staff: 0,
  unread_user: 0, whatsapp_opt_out_at: null, tg_receipt_at: null, profanity_count: 0, profanity_warned_at: null,
  blocked_at: null, blocked_by: null, block_reason: null,
}
const MESSAGE_DEFAULTS: Row = {
  author_id: null, author_name: null, subject: null, campaign_id: null, status: 'queued', error: null, external_id: null,
  reply_to_id: null, metadata: {}, sent_at: null, body_masked: null, flags: {},
}

export function commDb(seed: Record<string, Row[]> = {}) {
  let seq = 0
  const db: Record<string, Row[]> = { comm_threads: [], comm_messages: [], profiles: [], companies: [], ...seed }
  const writes: Array<{ table: string; op: string; payload: unknown }> = []
  const rpcCalls: Array<{ fn: string; args: unknown }> = []

  const conflict = (table: string, row: Row): boolean => {
    if (table === 'comm_threads') return db.comm_threads.some((r) => r.user_id === row.user_id)
    if (table === 'comm_messages' && row.direction === 'in' && row.external_id) {
      return db.comm_messages.some((r) => r.direction === 'in' && r.channel === row.channel && r.external_id === row.external_id)
    }
    return false
  }

  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      if (fn === 'comm_user_by_phone') {
        const hit = db.profiles.find((p) => phoneKey(p.phone as string | null) === args.p_key)
        return { data: hit?.id ?? null, error: null }
      }
      return { data: null, error: { code: 'PGRST202', message: 'no such function' } }
    },
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Row | Row[] | null = null
      let single = false
      let cap: number | null = null
      let sort: { col: string; asc: boolean } | null = null
      const filters: Array<(r: Row) => boolean> = []
      const run = () => {
        const rows = (db[table] ??= [])
        const match = (r: Row) => filters.every((f) => f(r))
        if (op === 'insert') {
          const list = Array.isArray(payload) ? payload : [payload!]
          if (list.some((p) => conflict(table, p))) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          const out: Row[] = []
          for (const p of list) {
            const now = new Date(Date.UTC(2026, 9, 16, 9, 0, ++seq)).toISOString()
            const defaults = table === 'comm_threads' ? THREAD_DEFAULTS : table === 'comm_messages' ? MESSAGE_DEFAULTS : {}
            const row: Row = { id: `${table}-${seq}`, created_at: now, updated_at: now, ...defaults, ...(table === 'comm_messages' ? { group_id: `g-${seq}` } : {}), ...p }
            rows.push(row)
            out.push(row)
          }
          writes.push({ table, op, payload })
          return { data: single ? out[0] ?? null : out, error: null }
        }
        if (op === 'update') {
          const hit = rows.filter(match)
          for (const r of hit) Object.assign(r, payload)
          writes.push({ table, op, payload })
          return { data: hit, error: null }
        }
        let found = rows.filter(match)
        if (sort) {
          const { col, asc } = sort
          found = [...found].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1))
        }
        if (cap !== null) found = found.slice(0, cap)
        return { data: single ? found[0] ?? null : found, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b },
        or: () => b,
        ilike: () => b,
        order: (col: string, o?: { ascending?: boolean }) => { sort = { col, asc: o?.ascending !== false }; return b },
        limit: (n: number) => { cap = n; return b },
        maybeSingle: () => { single = true; return Promise.resolve(run()) },
        single: () => { single = true; return Promise.resolve(run()) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  }
  return { sb: client as unknown as SupabaseClient, db, writes, rpcCalls }
}

/** Transports that record what they were asked to send. */
export function fakeTransports(opts: { telegram?: boolean; whatsapp?: boolean; fail?: string[] } = {}) {
  const sent: Array<{ channel: string; input: Record<string, unknown> }> = []
  const result = (channel: string) => (opts.fail?.includes(channel) ? { status: 'failed' as const, error: `${channel}_down` } : { status: 'sent' as const, externalId: `${channel}-ext` })
  return {
    sent,
    transports: {
      app: async (input: Record<string, unknown>) => { sent.push({ channel: 'app', input }); return opts.fail?.includes('app') ? { status: 'failed' as const, error: 'x' } : { status: 'delivered' as const } },
      email: async (input: Record<string, unknown>) => { sent.push({ channel: 'email', input }); return result('email') },
      telegram: async (input: Record<string, unknown>) => { sent.push({ channel: 'telegram', input }); return result('telegram') },
      whatsapp: async (input: Record<string, unknown>) => { sent.push({ channel: 'whatsapp', input }); return result('whatsapp') },
      telegramConfigured: () => opts.telegram ?? true,
      whatsappConfigured: () => opts.whatsapp ?? true,
    } as unknown as CommTransports,
  }
}
