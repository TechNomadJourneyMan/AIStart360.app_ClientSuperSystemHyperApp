/**
 * In-memory double of the service-role Supabase client for the broadcast
 * tests (lib/comm/campaigns.ts, audience.ts and the sendToUser path under them):
 * select / insert / upsert (ignoreDuplicates) / update with filters, order,
 * limit, range, `count: 'exact'` (also head), returning selects, the
 * `updated_at` trigger, and the unique rules of migration 120 — one thread per
 * user, inbound (channel, external_id), recipients (campaign_id, user_id,
 * channel). rpc() is delegated to the test (admin_list_users).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

const DEFAULTS: Record<string, Row> = {
  comm_threads: {
    company_id: null, assignee_id: null, status: 'open', mode: 'manual', last_inbound_at: null, last_outbound_at: null,
    last_message_at: null, last_message_preview: null, staff_reply_due_at: null, escalated_at: null, unread_staff: 0,
    unread_user: 0, whatsapp_opt_out_at: null, tg_receipt_at: null, profanity_count: 0, profanity_warned_at: null,
    blocked_at: null, blocked_by: null, block_reason: null,
  },
  comm_messages: {
    author_id: null, author_name: null, subject: null, campaign_id: null, status: 'queued', error: null, external_id: null,
    reply_to_id: null, metadata: {}, sent_at: null, body_masked: null, flags: {},
  },
  comm_campaigns: {
    subject: null, channels: [], audience: {}, status: 'draft', created_by: null, starts_at: null, started_at: null, finished_at: null,
    total_count: 0, sent_count: 0, failed_count: 0, skipped_count: 0,
  },
  comm_campaign_recipients: { status: 'pending', message_id: null, scheduled_for: null, attempts: 0, error: null },
}

const UNIQUE: Record<string, (a: Row, b: Row) => boolean> = {
  comm_threads: (a, b) => a.user_id === b.user_id,
  comm_messages: (a, b) => a.direction === 'in' && b.direction === 'in' && !!a.external_id && a.channel === b.channel && a.external_id === b.external_id,
  comm_campaign_recipients: (a, b) => a.campaign_id === b.campaign_id && a.user_id === b.user_id && a.channel === b.channel,
}

export interface CampaignDbOptions {
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }
  /** Clock of the updated_at trigger and created rows. */
  now?: () => Date
}

export function campaignDb(seed: Record<string, Row[]> = {}, opts: CampaignDbOptions = {}) {
  let seq = 0
  const db: Record<string, Row[]> = { profiles: [], companies: [], comm_threads: [], comm_messages: [], comm_campaigns: [], comm_campaign_recipients: [], ...seed }
  const queries: Array<{ table: string; op: string }> = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const clock = () => (opts.now ? opts.now() : new Date(Date.UTC(2026, 9, 19, 5, 0, 0) + seq * 1000))

  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return opts.rpc ? opts.rpc(fn, args) : { data: null, error: { code: 'PGRST202', message: 'no such function' } }
    },
    from(table: string) {
      let op: 'select' | 'insert' | 'upsert' | 'update' = 'select'
      let payload: Row | Row[] | null = null
      let ignoreDuplicates = false
      let returning = false
      let head = false
      let wantCount = false
      let single = false
      let cap: number | null = null
      let from = 0
      let to: number | null = null
      const sorts: Array<{ col: string; asc: boolean }> = []
      const filters: Array<(r: Row) => boolean> = []

      const run = () => {
        queries.push({ table, op })
        const rows = (db[table] ??= [])
        const match = (r: Row) => filters.every((f) => f(r))
        if (op === 'insert' || op === 'upsert') {
          const list = Array.isArray(payload) ? payload : [payload!]
          const unique = UNIQUE[table]
          const out: Row[] = []
          for (const p of list) {
            if (unique && (rows.some((r) => unique(r, p)) || out.some((r) => unique(r, p)))) {
              if (op === 'upsert' && ignoreDuplicates) continue
              return { data: null, error: { code: '23505', message: 'duplicate key' }, count: null }
            }
            seq++
            const at = clock().toISOString()
            out.push({ id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, created_at: at, updated_at: at, ...(DEFAULTS[table] ?? {}), ...(table === 'comm_messages' ? { group_id: `g-${seq}` } : {}), ...p })
          }
          rows.push(...out)
          return { data: returning ? (single ? out[0] ?? null : out) : null, error: null, count: null }
        }
        if (op === 'update') {
          const hit = rows.filter(match)
          const at = clock().toISOString()
          for (const r of hit) Object.assign(r, payload, 'updated_at' in r ? { updated_at: at } : {})
          const data = hit.map((r) => ({ ...r }))
          return { data: returning ? (single ? data[0] ?? null : data) : null, error: null, count: null }
        }
        let found = rows.filter(match)
        for (const { col, asc } of [...sorts].reverse()) {
          found = [...found].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1))
        }
        const count = found.length
        if (to !== null) found = found.slice(from, to + 1)
        if (cap !== null) found = found.slice(0, cap)
        if (head) return { data: null, error: null, count }
        return { data: single ? found[0] ?? null : found.map((r) => ({ ...r })), error: null, count: wantCount ? count : null }
      }

      const b: Record<string, unknown> = {
        select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
          if (op !== 'select') returning = true
          if (o?.head) head = true
          if (o?.count) wantCount = true
          return b
        },
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
        upsert: (p: Row | Row[], o?: { ignoreDuplicates?: boolean }) => { op = 'upsert'; payload = p; ignoreDuplicates = !!o?.ignoreDuplicates; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b },
        lte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return b },
        gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && String(r[c]) > String(v)); return b },
        or: () => b,
        ilike: () => b,
        order: (col: string, o?: { ascending?: boolean }) => { sorts.push({ col, asc: o?.ascending !== false }); return b },
        limit: (n: number) => { cap = n; return b },
        range: (a: number, z: number) => { from = a; to = z; return b },
        maybeSingle: () => { single = true; return Promise.resolve(run()) },
        single: () => { single = true; return Promise.resolve(run()) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  }
  return { sb: client as unknown as SupabaseClient, db, queries, rpcCalls }
}

/** admin_list_users over a fixed list of rows, paged like the SQL function. */
export function listUsersRpc(rows: Array<{ id: string }>) {
  return (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'admin_list_users') return { data: null, error: { message: 'no such function' } }
    const offset = Number(args.p_offset ?? 0)
    const limit = Number(args.p_limit ?? 200)
    return { data: rows.slice(offset, offset + limit).map((r) => ({ ...r, total_count: rows.length })), error: null }
  }
}
