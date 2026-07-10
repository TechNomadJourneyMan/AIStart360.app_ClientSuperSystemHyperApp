import { create } from 'zustand'

// ─── Types ───────────────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'archived'
export type RequestCategory = 'registration' | 'access' | 'support'
export type UserStatus = 'active' | 'blocked' | 'pending'
export type ActiveModule = 'requests' | 'crm' | 'clients' | 'leads' | 'market-insights' | 'insight-moderation'

export interface GriBlock {
  productScore: number
  trustScore: number
  businessModelScore: number
  cashScore: number
  operationsScore: number
  teamScore: number
  founderScore: number
}

export interface GigaClient {
  id: string
  name: string
  industry: string
  stage: string
  status: string
  website?: string | null
  createdAt: string
  manager: { id: string; name: string | null; email: string } | null
  latestGri: (GriBlock & { score: number; calculatedAt: string }) | null
  pulseMetrics: {
    riskScore: number
    churnLevel: string
    churnProb: number
    avgCheck: number
    lastOrder: string | null
    daysSince: number | null
  } | null
}

export interface GigaRequest {
  id: string
  category: RequestCategory
  status: RequestStatus
  userName: string
  userEmail: string
  userAvatar?: string
  subject: string
  description: string
  createdAt: string
  company?: string
  rejectionReason?: string
  source?: string | null
  surveyData?: {
    answers: Record<string, unknown>
    company: Record<string, unknown> | null
    completedSteps: number[]
  }
}

export interface GigaUser {
  id: string
  name: string | null
  email: string
  role: string
  status: UserStatus
  lastLogin: string | null
  createdAt: string
  avatarUrl?: string | null
  org?: string | null
  widgets: string[]
}

// ─── (Mock data removed — requests now fetched from Supabase via API) ─────────

// (end of removed mock — do not use _REMOVED_MOCK)

// ─── Default Widget Set ───────────────────────────────────────────────────────

export const ALL_WIDGETS = [
  { id: 'gri-score', label: 'GRI Score' },
  { id: 'pulse', label: 'GRI Pulse' },
  { id: 'clients', label: 'Клиенты' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'reports', label: 'Отчёты' },
  { id: 'ai-scanner', label: 'AI Scanner' },
  { id: 'competitors', label: 'Конкуренты' },
  { id: 'market', label: 'Рынок' },
  { id: 'team', label: 'Команда' },
  { id: 'notifications', label: 'Уведомления' },
]

// ─── Store ────────────────────────────────────────────────────────────────────

interface GigaPanelStore {
  activeModule: ActiveModule
  activeRequestTab: RequestCategory
  requests: GigaRequest[]
  isLoadingRequests: boolean
  requestsError: string | null
  users: GigaUser[]
  isLoadingUsers: boolean
  usersError: string | null
  clients: GigaClient[]
  isLoadingClients: boolean
  clientsError: string | null
  selectedClient: GigaClient | null

  setActiveModule: (module: ActiveModule) => void
  setActiveRequestTab: (tab: RequestCategory) => void

  setRequests: (requests: GigaRequest[]) => void
  setLoadingRequests: (loading: boolean) => void
  setRequestsError: (error: string | null) => void
  approveRequest: (id: string) => void
  rejectRequest: (id: string, reason: string) => void
  archiveRequest: (id: string) => void

  setUsers: (users: GigaUser[]) => void
  setLoadingUsers: (loading: boolean) => void
  setUsersError: (error: string | null) => void
  blockUser: (id: string) => void
  updateUserWidgets: (id: string, widgets: string[]) => void

  setClients: (clients: GigaClient[]) => void
  setLoadingClients: (loading: boolean) => void
  setClientsError: (error: string | null) => void
  setSelectedClient: (client: GigaClient | null) => void
}

export const useGigaPanelStore = create<GigaPanelStore>((set) => ({
  activeModule: 'requests',
  activeRequestTab: 'registration',
  requests: [],
  isLoadingRequests: false,
  requestsError: null,
  users: [],
  isLoadingUsers: false,
  usersError: null,
  clients: [],
  isLoadingClients: false,
  clientsError: null,
  selectedClient: null,

  setActiveModule: (module) => set({ activeModule: module }),
  setActiveRequestTab: (tab) => set({ activeRequestTab: tab }),

  setRequests: (requests) => set({ requests }),
  setLoadingRequests: (loading) => set({ isLoadingRequests: loading }),
  setRequestsError: (error) => set({ requestsError: error }),

  approveRequest: (id) =>
    set((state) => ({
      requests: state.requests.map((r) =>
        r.id === id ? { ...r, status: 'approved' as RequestStatus } : r,
      ),
    })),

  rejectRequest: (id, reason) =>
    set((state) => ({
      requests: state.requests.map((r) =>
        r.id === id
          ? { ...r, status: 'rejected' as RequestStatus, rejectionReason: reason }
          : r,
      ),
    })),

  archiveRequest: (id) =>
    set((state) => ({
      requests: state.requests.map((r) =>
        r.id === id ? { ...r, status: 'archived' as RequestStatus } : r,
      ),
    })),

  setUsers: (users) => set({ users }),
  setLoadingUsers: (loading) => set({ isLoadingUsers: loading }),
  setUsersError: (error) => set({ usersError: error }),

  blockUser: (id) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id ? { ...u, status: 'blocked' as UserStatus } : u,
      ),
    })),

  updateUserWidgets: (id, widgets) =>
    set((state) => ({
      users: state.users.map((u) => (u.id === id ? { ...u, widgets } : u)),
    })),

  setClients: (clients) => set({ clients }),
  setLoadingClients: (loading) => set({ isLoadingClients: loading }),
  setClientsError: (error) => set({ clientsError: error }),
  setSelectedClient: (client) => set({ selectedClient: client }),
}))
