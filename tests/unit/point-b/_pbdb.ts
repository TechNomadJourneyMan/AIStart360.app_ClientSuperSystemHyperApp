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
 *   - the unique partial index (user_id, pb_task_key) of action_items (migration 128);
 *   - the unique partial index of active invites (user_id, dedupe_key) of pb_invites (migration 129);
 *   - (version_id, period) of pb_checkpoints and (company_id, period, metric) of pb_monthly_facts (migration 132);
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
  action_items: () => ({
    status: 'open', description: null, owner: null, due_date: null, expected_effect: null, linked_block: null, priority: 3,
    source: 'plan', pb_task_key: null, pb_version_id: null, completed_at: null,
  }),
  metric_targets: () => ({ direction: 'higher_is_better', source: 'owner', note: null, set_by: null, deadline: null, label: null, baseline_value: null, baseline_period: null }),
  // migration 129
  pb_recommendations: () => ({
    version_id: null, essence: '', reason: '', expected_effect: null, resources: null, confidence: 'medium', confidence_reason: null, risks: null,
    next_action: null, source_refs: [], status: 'pending_review', inputs_hash: null, rec_version: 1, supersedes_id: null, reviewer_id: null,
    reviewer_name: null, reviewer_specialty: null, reviewed_at: null, scope_note: null, review_comment: null,
  }),
  pb_invites: () => ({
    kind: 'insight', body: '', href: null, why: '', source_refs: [], priority: 5, display: 'card', status: 'new', snoozed_until: null,
    expires_at: null, delivered: {}, source_rec_id: null,
  }),
  // migration 132
  pb_checkpoints: () => ({ planned: {}, actual: {}, forecast: {}, verdict: {}, overall: 'no_data', reason: null, inputs_hash: null }),
  pb_runs: () => ({
    status: 'running', company_id: null, triggered_by: null, finished_at: null, companies: 0, skipped: 0, ai_calls: 0, cost: 0, errors: [], cursor: null,
  }),
  pb_monthly_facts: () => ({ source: 'monthly_reconciliation', entered_by: null, note: null }),
}

/** Tables of migration 129: uuid ids (the routes validate them) and an updated_at stamp on every write. */
const UUID_TABLES = new Set(['pb_saved_scenarios', 'pb_recommendations', 'pb_invites', 'pb_checkpoints', 'pb_runs', 'pb_monthly_facts'])
const STAMPED_TABLES = new Set(['pb_finmodel_inputs', 'pb_recommendations', 'pb_invites', 'pb_checkpoints', 'pb_monthly_facts'])
/** pb_invites_active_dedupe_uidx: one active invite per (user_id, dedupe_key). */
const ACTIVE_INVITE = ['new', 'seen', 'snoozed']

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
  // action_items_pb_task_uidx (migration 128): one row per (user_id, pb_task_key) where the key is set.
  if (table === 'action_items') {
    return row.pb_task_key != null && others.some((r) => r.user_id === row.user_id && r.pb_task_key === row.pb_task_key)
  }
  if (table === 'metric_targets') {
    return others.some((r) => r.company_id === row.company_id && r.metric_key === row.metric_key && r.period_label === row.period_label)
  }
  if (table === 'pb_checkpoints') return others.some((r) => r.version_id === row.version_id && r.period === row.period)
  if (table === 'pb_monthly_facts') {
    return others.some((r) => r.company_id === row.company_id && r.period === row.period && r.metric === row.metric)
  }
  if (table === 'pb_invites') {
    return ACTIVE_INVITE.includes(String(row.status))
      && others.some((r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key && ACTIVE_INVITE.includes(String(r.status)))
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
    pb_plans: [], pb_plan_versions: [], pb_goal_reviews: [], pb_finmodel_inputs: [], pb_saved_scenarios: [], action_items: [], metric_targets: [], companies: [], profiles: [],
    pb_recommendations: [], pb_invites: [], pb_checkpoints: [], pb_runs: [], pb_monthly_facts: [], ...structuredClone(seed),
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
              if (hit) { Object.assign(hit, structuredClone(p), STAMPED_TABLES.has(table) ? { updated_at: stamp() } : {}); out.push(hit); writes.push({ table, op, payload: p }); continue }
            }
            const row: Row = { id: UUID_TABLES.has(table) ? uuidOf(++seq) : `${table}-${++seq}`, created_at: stamp(), ...(table === 'pb_saved_scenarios' || STAMPED_TABLES.has(table) ? { updated_at: stamp() } : {}), ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(p) }
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
          for (const r of hit) Object.assign(r, structuredClone(payload as Row), STAMPED_TABLES.has(table) ? { updated_at: stamp() } : {})
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
