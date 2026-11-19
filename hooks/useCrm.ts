import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ClientStatus } from '@/lib/crm/client-validate'

// ─── Types (mirror app/api/v1/crm/* contracts) ──────────────────────────────

export type CrmClientStatus = ClientStatus
export type InteractionKind = 'call' | 'message' | 'meeting' | 'note' | 'status_change'
export type ReminderStatus = 'open' | 'done' | 'dismissed'
export type QueueBucket = 'overdue' | 'today' | 'no_plan' | 'sleeping'

/** Full row from GET /api/v1/crm/clients (snake_case, matches crm_clients). */
export interface CrmClient {
  id: string
  user_id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  status: CrmClientStatus
  source: string | null
  avg_check: number | null
  note: string | null
  next_contact_at: string | null
  last_contact_at: string | null
  created_at: string
  updated_at: string
}

export interface CrmInteraction {
  id: string
  kind: InteractionKind
  comment: string | null
  created_at: string
}

export interface CrmReminder {
  id: string
  due_at: string
  note: string | null
  status: ReminderStatus
  created_at: string
  done_at: string | null
}

/**
 * A row of the «Сегодня» queue / risk list (GET /api/v1/crm/today, lib/crm/today.ts TodayClient).
 * Only what the owner's base holds: no order history, no order cycle, no volume trend.
 */
export interface CrmTodayClient {
  id: string
  name: string
  status: CrmClientStatus
  statusLabel: string
  phone: string | null
  phoneRaw: string | null
  email: string | null
  /** A preview: cut to 300 characters when longer (then noteTruncated). */
  note: string | null
  noteTruncated: boolean
  nextContactAt: string | null
  lastContactAt: string | null
  /** Whole days since the last touch; null = never touched («нет касаний»). */
  daysSince: number | null
  /** null = no average check entered. */
  avgCheck: number | null
  /** % of the check against the base's average check; null when unknown. */
  checkVsAvgPct: number | null
  riskScore: number
  churnLevel: 'high' | 'medium' | 'low'
  action: 'call' | 'message' | 'monitor'
  comment: string | null
  /** 0 overdue · 1 today · 2 no plan · 3 sleeping; null = not in today's queue. */
  queueBucket: 0 | 1 | 2 | 3 | null
}

export interface CrmTodayStats {
  totalClients: number
  highRisk: number
  mediumRisk: number
  /** Σ avg_check of the high-risk clients; null = «нет данных» (some check unknown). */
  revenueAtRisk: number | null
  highRiskWithoutCheck: number
  processedToday: number
  queue: { overdue: number; today: number; noPlan: number; sleeping: number }
}

export interface CrmTodayData {
  day: string
  stats: CrmTodayStats
  /** The first TODAY_LIST_MAX (50) of the queue, highest priority first. */
  todayClients: CrmTodayClient[]
  /** The whole queue's size («показаны N из M»). */
  todayClientsTotal: number
  riskClients: CrmTodayClient[]
  riskClientsTotal: number
  aiBriefing: string | null
}

/** The whole base (GET /api/v1/crm/clients, every page) + how many the server counts. */
export interface CrmClientsData {
  clients: CrmClient[]
  total: number
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

/** Unwrap the `{ok, data|error}` envelope; throw on failure. */
async function fetchEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON error body */
  }
  const body = (json ?? {}) as { ok?: boolean; data?: T; error?: string; code?: string; message?: string }
  if (!res.ok || body.ok === false) {
    const err = new Error(body.message || body.error || `request failed (${res.status})`) as Error & { code?: string }
    err.code = body.code ?? body.error
    throw err
  }
  return body.data as T
}

/**
 * What the screen says when logging a touch failed. «queue_not_updated»: the touch IS in the
 * timeline but the queue was not updated (app/api/v1/crm/clients/[id]/interactions) — the
 * server's message says so; anything else: the touch was not recorded.
 */
export function touchErrorText(e: unknown): string {
  const err = e as { code?: unknown; message?: unknown } | null
  if (err && err.code === 'queue_not_updated' && typeof err.message === 'string' && err.message) return err.message
  return 'Не удалось записать касание'
}

/**
 * What the drawer says when «Выполнено» / «Отменить» on a reminder failed: the server's message
 * for «queue_not_updated» (marked done, but the queue was not updated —
 * app/api/v1/crm/reminders/[id]) and «reminder_closed» (409: already closed); otherwise a plain one.
 */
export function reminderErrorText(e: unknown): string {
  const err = e as { code?: unknown; message?: unknown } | null
  if (err && (err.code === 'queue_not_updated' || err.code === 'reminder_closed') && typeof err.message === 'string' && err.message) {
    return err.message
  }
  return 'Не удалось обновить напоминание'
}

export const crmKeys = {
  all: ['crm'] as const,
  today: () => ['crm', 'today'] as const,
  // Prefix used for invalidation so ALL status-filtered client caches are
  // refreshed (react-query does prefix-match); the parameterized `clients`
  // key is for the queries themselves.
  clientsRoot: () => ['crm', 'clients'] as const,
  clients: (status?: CrmClientStatus | 'all') => ['crm', 'clients', status ?? 'all'] as const,
  interactions: (clientId: string) => ['crm', 'interactions', clientId] as const,
  reminders: (clientId: string) => ['crm', 'reminders', clientId] as const,
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/crm/today — returns a BARE pulse-compatible shape
 * `{stats, todayClients, aiBriefing}` (NOT the {ok,data} envelope).
 */
export function useCrmToday() {
  return useQuery({
    queryKey: crmKeys.today(),
    queryFn: async (): Promise<CrmTodayData> => {
      const res = await fetch('/api/v1/crm/today')
      if (!res.ok) throw new Error(`Не удалось загрузить очередь (${res.status})`)
      return res.json() as Promise<CrmTodayData>
    },
  })
}

/** Page size of GET /api/v1/crm/clients (the server's maximum). */
export const CRM_CLIENTS_PAGE = 1000
/** Safety stop for the page loop (1000 pages = a million clients). */
const MAX_CLIENT_PAGES = 1000

/** Display order of the base: the nearest planned contact first (none last), then the newest. */
export function sortBase(clients: CrmClient[]): CrmClient[] {
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN)
  return [...clients].sort((a, b) => {
    const na = t(a.next_contact_at)
    const nb = t(b.next_contact_at)
    if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1
    if (!Number.isNaN(na) && na !== nb) return na - nb
    return (t(b.created_at) || 0) - (t(a.created_at) || 0) || a.id.localeCompare(b.id)
  })
}

/**
 * The owner's WHOLE base: GET /api/v1/crm/clients page by page (keyset cursor) until the last page,
 * so a base over one page is never silently cut. `total` is the server's count, for «N из M».
 */
export function useCrmClients(status?: CrmClientStatus, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: crmKeys.clients(status),
    queryFn: () => fetchWholeBase(status),
    enabled: opts.enabled ?? true,
  })
}

/** Every page of GET /api/v1/crm/clients (exported for tests). */
export async function fetchWholeBase(status?: CrmClientStatus): Promise<CrmClientsData> {
  const seen = new Set<string>()
  const all: CrmClient[] = []
  let total = 0
  let after: string | null = null
  for (let i = 0; i < MAX_CLIENT_PAGES; i++) {
    const qs = new URLSearchParams({ limit: String(CRM_CLIENTS_PAGE) })
    if (status) qs.set('status', status)
    if (after) qs.set('after', after)
    const page: { clients: CrmClient[]; total: number; nextCursor: string | null } = await fetchEnvelope(
      `/api/v1/crm/clients?${qs.toString()}`,
    )
    total = page.total
    for (const c of page.clients) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      all.push(c)
    }
    // Done only when the server says there is no next page (it answers an empty page with
    // nextCursor null). Not «once `total` clients are here»: the count is a separate query and is
    // stale during a concurrent insert — a client added meanwhile would never be shown.
    if (!page.nextCursor) break
    after = page.nextCursor
  }
  return { clients: sortBase(all), total }
}

/** GET /api/v1/crm/clients/[id]/interactions — enveloped. */
export function useCrmInteractions(clientId: string | null) {
  return useQuery({
    queryKey: crmKeys.interactions(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async (): Promise<CrmInteraction[]> => {
      const data = await fetchEnvelope<{ interactions: CrmInteraction[] }>(
        `/api/v1/crm/clients/${clientId}/interactions`,
      )
      return data.interactions
    },
  })
}

/** GET /api/v1/crm/clients/[id]/reminders — enveloped, open reminders only. */
export function useCrmReminders(clientId: string | null) {
  return useQuery({
    queryKey: crmKeys.reminders(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async (): Promise<CrmReminder[]> => {
      const data = await fetchEnvelope<{ reminders: CrmReminder[] }>(
        `/api/v1/crm/clients/${clientId}/reminders`,
      )
      return data.reminders
    },
  })
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export interface AddClientInput {
  name: string
  phone?: string
  email?: string
  status?: CrmClientStatus
  avg_check?: number | null
  note?: string
  next_contact_at?: string | null
  source?: string
}

/** POST /api/v1/crm/clients. Throws 'phone_conflict' on duplicate phone. */
export function useAddClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddClientInput) =>
      fetchEnvelope<{ client: CrmClient }>('/api/v1/crm/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.all })
    },
  })
}

export interface UpdateClientInput {
  id: string
  patch: Partial<{
    name: string
    phone: string
    email: string | null
    status: CrmClientStatus
    avg_check: number | null
    note: string | null
    next_contact_at: string | null
    source: string
  }>
}

/** PATCH /api/v1/crm/clients/[id]. Status change auto-writes a status_change touch. */
export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: UpdateClientInput) =>
      fetchEnvelope<{ client: CrmClient }>(`/api/v1/crm/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: crmKeys.all })
      qc.invalidateQueries({ queryKey: crmKeys.interactions(id) })
    },
  })
}

/** DELETE /api/v1/crm/clients/[id]. */
export function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchEnvelope<{ deleted: string }>(`/api/v1/crm/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.all })
    },
  })
}

export interface LogInteractionInput {
  clientId: string
  kind: Exclude<InteractionKind, 'status_change'>
  comment?: string
}

/** The options of useLogInteraction (exported for tests). */
export function logInteractionMutation(qc: Pick<QueryClient, 'invalidateQueries'>) {
  return {
    mutationFn: ({ clientId, kind, comment }: LogInteractionInput) =>
      fetchEnvelope<{ interaction: CrmInteraction }>(
        `/api/v1/crm/clients/${clientId}/interactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, comment }),
        },
      ),
    // A contact closes the client's reminders due today on the server — the drawer's reminder list
    // is refreshed with the queue. On settle, not only success: a 500 «queue_not_updated» still
    // recorded the touch (and may have closed some), so the screen re-reads what is stored.
    onSettled: (_data: unknown, _error: unknown, { clientId }: LogInteractionInput) => {
      qc.invalidateQueries({ queryKey: crmKeys.today() })
      qc.invalidateQueries({ queryKey: crmKeys.clientsRoot() })
      qc.invalidateQueries({ queryKey: crmKeys.interactions(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.reminders(clientId) })
    },
  }
}

/** POST /api/v1/crm/clients/[id]/interactions. Bumps client.last_contact_at. */
export function useLogInteraction() {
  const qc = useQueryClient()
  return useMutation(logInteractionMutation(qc))
}

export interface AddReminderInput {
  clientId: string
  due_at: string
  note?: string
}

/** POST /api/v1/crm/clients/[id]/reminders. */
export function useAddReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clientId, due_at, note }: AddReminderInput) =>
      fetchEnvelope<{ reminder: CrmReminder }>(`/api/v1/crm/clients/${clientId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_at, note }),
      }),
    onSuccess: (_data, { clientId }) => {
      qc.invalidateQueries({ queryKey: crmKeys.reminders(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.today() })
    },
  })
}

export interface CompleteReminderInput {
  id: string
  clientId: string
  status?: 'done' | 'dismissed'
  next_contact_at?: string
}

/** PATCH /api/v1/crm/reminders/[id]. done writes a touch + bumps dates. */
export function useCompleteReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status = 'done', next_contact_at }: CompleteReminderInput) =>
      fetchEnvelope<{ reminder: CrmReminder }>(`/api/v1/crm/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, next_contact_at }),
      }),
    // On settle: a 409 «уже закрыто» means the list on screen is stale — re-read it.
    onSettled: (_data, _error, { clientId }) => {
      qc.invalidateQueries({ queryKey: crmKeys.reminders(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.interactions(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.today() })
      qc.invalidateQueries({ queryKey: crmKeys.clientsRoot() })
    },
  })
}
