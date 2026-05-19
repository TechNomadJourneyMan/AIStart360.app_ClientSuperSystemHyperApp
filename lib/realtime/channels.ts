/**
 * Realtime channel helpers — pure, no React, no Supabase dependency.
 * Used by `hooks/useRealtimeSync.ts` and composition hooks under `hooks/`.
 *
 * Migration 016 enabled the `supabase_realtime` publication on
 *   public.metrics, public.diagnostics, public.documents
 * with REPLICA IDENTITY FULL, so we can subscribe to INSERT/UPDATE/DELETE
 * events and receive the full row payload.
 */

export type WatchedTable = 'metrics' | 'diagnostics' | 'documents'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

export interface ChannelDescriptor {
  table: WatchedTable
  /** Postgres filter expression in Supabase Realtime syntax, e.g. "company_id=eq.<uuid>". */
  filter?: string
  /** Channel name (must be unique per subscription). Auto-derived if omitted. */
  name?: string
  /** Which events to listen for. Default: '*'. */
  event?: RealtimeEvent
}

/**
 * Build a Supabase Realtime filter expression for a single equality predicate.
 * Returns a string like "company_id=eq.<uuid>".
 *
 * NOTE: Supabase Realtime filter syntax is intentionally narrow — only
 * `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in` are accepted server-side, and
 * the value must be a string. We expose only `eq` for simplicity; callers
 * needing other operators can construct the filter manually.
 */
export function buildFilter(column: string, value: string): string {
  if (!column) throw new Error('buildFilter: column is required')
  if (value == null) throw new Error('buildFilter: value is required')
  return `${column}=eq.${value}`
}

/**
 * Derive a stable channel name from a descriptor + caller-scoping userId.
 *
 * Channel names MUST be unique per subscription within a Supabase project; if
 * two clients open the same name, events are multiplexed and we get duplicate
 * invalidations. Scoping by userId guarantees per-tab isolation in dev
 * (React strict mode double-mount) and across users in prod.
 *
 * Format: `realtime:<table>:user-<userId>:<filter-or-all>:<event>`
 */
export function buildChannelName(d: ChannelDescriptor, userId: string): string {
  if (d.name) return d.name
  const filterPart = d.filter ? d.filter.replace(/[^a-zA-Z0-9_=.-]/g, '_') : 'all'
  const event = d.event ?? '*'
  return `realtime:${d.table}:user-${userId}:${filterPart}:${event}`
}

/**
 * Stable key for a binding — used by `useRealtimeSync` to detect when the
 * caller's bindings array has changed in a meaningful way (vs. mere
 * re-render reference churn). Two bindings are equivalent iff this key
 * matches.
 */
export function bindingKey(d: ChannelDescriptor): string {
  return `${d.table}::${d.filter ?? ''}::${d.event ?? '*'}`
}
