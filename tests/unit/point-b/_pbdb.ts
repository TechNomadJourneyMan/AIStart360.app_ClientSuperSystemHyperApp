/**
 * In-memory double of the service-role Supabase client for the Point B plan
 * tests: the query-builder subset the plan store / goals use (select, insert,
 * update, upsert with onConflict, delete, eq / neq / is / in / lt / lte / gt /
 * gte / not / or-less filters, order, limit, single / maybeSingle) and the
 * rules of migration 125 / 085 that matter for the logic:
 *   - unique company_id on pb_plans, (plan_id, version) and «one open version
 *     per plan» on pb_plan_versions, (company_id, metric_key, period_label) on
 *     metric_targets (23505, like PostgREST);
 *   - the immutability trigger of pb_plan_versions: an approved row may only
 *     become superseded, a superseded row is frozen (23514);
 *   - an update is atomic, so two «conditional» updates race exactly like in SQL.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
type Err = { code: string; message: string }

const OPEN = ['draft', 'in_review']

const DEFAULTS: Record<string, () => Row> = {
  pb_plans: () => ({ current_version_id: null, published_version_id: null, settings: {} }),
  pb_plan_versions: () => ({
    status: 'draft', base_snapshot_id: null, assumptions: {}, scenarios: [], selected_scenario: null, strategy: {}, risks: [],
    expert_notes: null, change_reason: null, author_id: null, author_name: null, author_kind: 'expert', submitted_at: null,
    approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  }),
  pb_goal_reviews: () => ({
    proposed_value: null, proposed_deadline: null, previous_value: null, reason: null, reviewer_id: null, reviewer_name: null,
    owner_agreed_at: null, applied_without_agreement: false, reminded_at: null,
  }),
  pb_finmodel_inputs: () => ({
    period_key: '', as_of: null, status: 'entered', note: null, verified_by: null, verified_by_name: null, verified_at: null, updated_by: null,
  }),
  pb_saved_scenarios: () => ({ note: null, summary: {}, proposed_at: null, proposal_message_id: null }),
  metric_targets: () => ({ direction: 'higher_is_better', source: 'owner', note: null, set_by: null, deadline: null, label: null, baseline_value: null, baseline_period: null }),
}

function uniqueViolation(table: string, rows: Row[], row: Row, ignoreId?: unknown): boolean {
  const others = rows.filter((r) => r.id !== ignoreId)
  if (table === 'pb_plans') return others.some((r) => r.company_id === row.company_id)
  if (table === 'pb_plan_versions') {
    if (others.some((r) => r.plan_id === row.plan_id && r.version === row.version)) return true
    return OPEN.includes(String(row.status)) && others.some((r) => r.plan_id === row.plan_id && OPEN.includes(String(r.status)))
  }
  if (table === 'pb_finmodel_inputs') {
    return others.some((r) => r.company_id === row.company_id && r.key === row.key && r.period_key === row.period_key)
  }
  if (table === 'metric_targets') {
    return others.some((r) => r.company_id === row.company_id && r.metric_key === row.metric_key && r.period_label === row.period_label)
  }
  return false
}

/** The trigger pb_plan_versions_immutable. */
function immutableViolation(table: string, before: Row, after: Row): boolean {
  if (table !== 'pb_plan_versions') return false
  if (before.status === 'approved') {
    if (after.status !== 'superseded') return true
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const k of keys) if (k !== 'status' && JSON.stringify(before[k]) !== JSON.stringify(after[k])) return true
    return false
  }
  return before.status === 'superseded'
}

/** A v4-shaped uuid from a counter (the saved what-if routes validate ids as uuids). */
const uuidOf = (n: number): string => `5a5a5a5a-0000-4000-8000-${String(n).padStart(12, '0')}`

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const x = String(a ?? ''), y = String(b ?? '')
  return x < y ? -1 : x > y ? 1 : 0
}

export function pbDb(seed: Record<string, Row[]> = {}) {
  let seq = 0
  const db: Record<string, Row[]> = {
    pb_plans: [], pb_plan_versions: [], pb_goal_reviews: [], pb_finmodel_inputs: [], pb_saved_scenarios: [], metric_targets: [], companies: [], profiles: [], ...structuredClone(seed),
  }
  const writes: Array<{ table: string; op: string; payload: unknown }> = []
  const stamp = () => new Date(Date.UTC(2026, 9, 18, 9, 0, ++seq)).toISOString()

  const client = {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
      let payload: Row | Row[] | null = null
      let conflictCols: string[] = []
      let single = false
      let cap: number | null = null
      const sorts: Array<{ col: string; asc: boolean }> = []
      const filters: Array<(r: Row) => boolean> = []

      const run = (): { data: unknown; error: Err | null } => {
        const rows = (db[table] ??= [])
        const match = (r: Row) => filters.every((f) => f(r))
        const ret = (list: Row[]) => (single ? (list[0] ? { ...list[0] } : null) : list.map((r) => ({ ...r })))
        if (op === 'insert' || op === 'upsert') {
          const out: Row[] = []
          for (const p of Array.isArray(payload) ? payload : [payload!]) {
            if (op === 'upsert' && conflictCols.length) {
              const hit = rows.find((r) => conflictCols.every((c) => r[c] === p[c]))
              if (hit) { Object.assign(hit, structuredClone(p), table === 'pb_finmodel_inputs' ? { updated_at: stamp() } : {}); out.push(hit); writes.push({ table, op, payload: p }); continue }
            }
            const row: Row = { id: table === 'pb_saved_scenarios' ? uuidOf(++seq) : `${table}-${++seq}`, created_at: stamp(), ...(table === 'pb_saved_scenarios' ? { updated_at: stamp() } : {}), ...(table === 'pb_finmodel_inputs' ? { updated_at: stamp() } : {}), ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(p) }
            if (uniqueViolation(table, rows, row)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${table})` } }
            rows.push(row)
            out.push(row)
            writes.push({ table, op, payload: p })
          }
          return { data: ret(out), error: null }
        }
        if (op === 'delete') {
          const gone = rows.filter(match)
          db[table] = rows.filter((r) => !match(r))
          writes.push({ table, op, payload: gone.map((r) => r.id) })
          return { data: ret(gone), error: null }
        }
        if (op === 'update') {
          const hit = rows.filter(match)
          for (const r of hit) {
            const next = { ...r, ...structuredClone(payload as Row) }
            if (immutableViolation(table, r, next)) return { data: null, error: { code: '23514', message: 'pb_plan_versions: immutable' } }
            if (uniqueViolation(table, rows, next, r.id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
          }
          for (const r of hit) Object.assign(r, structuredClone(payload as Row), table === 'pb_finmodel_inputs' ? { updated_at: stamp() } : {})
          if (hit.length) writes.push({ table, op, payload })
          return { data: ret(hit), error: null }
        }
        let found = rows.filter(match)
        for (const { col, asc } of [...sorts].reverse()) found = [...found].sort((a, b) => cmp(a[col], b[col]) * (asc ? 1 : -1))
        if (cap !== null) found = found.slice(0, cap)
        return { data: ret(found), error: null }
      }

      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        upsert: (p: Row | Row[], o?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflictCols = (o?.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean); return b },
        delete: () => { op = 'delete'; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        not: (c: string, o: string, v: unknown) => { filters.push((r) => (o === 'is' && v === null ? r[c] != null : r[c] !== v)); return b },
        lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return b },
        lte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return b },
        gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return b },
        gte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return b },
        order: (col: string, o?: { ascending?: boolean }) => { sorts.push({ col, asc: o?.ascending !== false }); return b },
        limit: (n: number) => { cap = n; return b },
        maybeSingle: () => { single = true; return Promise.resolve(run()) },
        single: () => {
          single = true
          const res = run()
          return Promise.resolve(res.error || res.data ? res : { data: null, error: { code: 'PGRST116', message: 'no rows' } })
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  }
  return { sb: client as unknown as SupabaseClient, db, writes }
}
