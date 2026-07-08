import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

/** A row in the «Сегодня» queue — pulse-compatible fields PLUS native CRM fields. */
export interface CrmTodayClient {
  // pulse-compatible (reused by ClientCard / RiskBadge / RiskBar / MiniSparkline)
  id: string
  name: string
  sector: string
  forbes: number | null
  lastOrder: string | null
  daysSince: number
  avgCheck: number
  volumeChange: number
  riskScore: number
  churnProb: number
  churnLevel: 'high' | 'medium' | 'low'
  comment: string | null
  action: 'call' | 'message' | 'monitor'
  history: number[]
  orderCycle: number
  // native CRM fields
  status: CrmClientStatus
  phone: string | null
  phoneRaw?: string | null
  email: string | null
  note?: string | null
  nextContactAt: string | null
  lastContactAt: string | null
  // API returns a numeric bucket (0..3); we keep it as-is for ordering.
  queueBucket: number
}

export interface CrmTodayStats {
  revenueAtRisk: number
  highRisk: number
  mediumRisk: number
  totalClients: number
  processedToday: number
  dailyTarget: number
}

export interface CrmTodayData {
  stats: CrmTodayStats
  todayClients: CrmTodayClient[]
  aiBriefing: string | null
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
  const body = (json ?? {}) as { ok?: boolean; data?: T; error?: string; message?: string }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || body.error || `request failed (${res.status})`)
  }
  return body.data as T
}

export const crmKeys = {
  all: ['crm'] as const,
  today: () => ['crm', 'today'] as const,
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
      if (!res.ok) throw new Error('Failed to fetch CRM today queue')
      return res.json() as Promise<CrmTodayData>
    },
  })
}

/** GET /api/v1/crm/clients?status= — enveloped `{ok,data:{clients}}`. */
export function useCrmClients(status?: CrmClientStatus) {
  return useQuery({
    queryKey: crmKeys.clients(status),
    queryFn: async (): Promise<CrmClient[]> => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : ''
      const data = await fetchEnvelope<{ clients: CrmClient[] }>(`/api/v1/crm/clients${qs}`)
      return data.clients
    },
  })
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

/** POST /api/v1/crm/clients/[id]/interactions. Bumps client.last_contact_at. */
export function useLogInteraction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clientId, kind, comment }: LogInteractionInput) =>
      fetchEnvelope<{ interaction: CrmInteraction }>(
        `/api/v1/crm/clients/${clientId}/interactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, comment }),
        },
      ),
    onSuccess: (_data, { clientId }) => {
      qc.invalidateQueries({ queryKey: crmKeys.today() })
      qc.invalidateQueries({ queryKey: crmKeys.clients() })
      qc.invalidateQueries({ queryKey: crmKeys.interactions(clientId) })
    },
  })
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
    onSuccess: (_data, { clientId }) => {
      qc.invalidateQueries({ queryKey: crmKeys.reminders(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.interactions(clientId) })
      qc.invalidateQueries({ queryKey: crmKeys.today() })
      qc.invalidateQueries({ queryKey: crmKeys.clients() })
    },
  })
}
