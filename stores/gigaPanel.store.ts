import { create } from 'zustand'

// ─── Types ───────────────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'archived'
export type RequestCategory = 'registration' | 'access' | 'support'
export type UserStatus = 'active' | 'blocked' | 'pending'
export type ActiveModule = 'requests' | 'crm' | 'clients'

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

const _REMOVED_MOCK: GigaRequest[] = [
  {
    id: 'req-001',
    category: 'registration',
    status: 'pending',
    userName: 'Алина Кожевникова',
    userEmail: 'a.kozhevnikova@techstartup.kz',
    subject: 'Регистрация компании TechStartup KZ',
    description: 'Запрос на регистрацию команды из 5 человек. Отрасль: финтех. Планируем использовать GRI-анализ для оценки зрелости продукта.',
    createdAt: '2026-03-26T09:15:00Z',
    company: 'TechStartup KZ',
  },
  {
    id: 'req-002',
    category: 'registration',
    status: 'pending',
    userName: 'Марат Сейткали',
    userEmail: 'm.seitkali@invest-almaty.kz',
    subject: 'Новый аккаунт — Invest Almaty',
    description: 'Инвестиционный фонд. Хотим интегрировать портал для portfolio-компаний.',
    createdAt: '2026-03-25T14:30:00Z',
    company: 'Invest Almaty',
  },
  {
    id: 'req-003',
    category: 'registration',
    status: 'pending',
    userName: 'Диана Ахметова',
    userEmail: 'd.akhmetova@smartlogistics.kz',
    subject: 'Активация аккаунта — Smart Logistics',
    description: 'B2B логистика. Интерес к блоку Pulse для мониторинга клиентской базы.',
    createdAt: '2026-03-24T11:00:00Z',
    company: 'Smart Logistics',
  },
  {
    id: 'req-004',
    category: 'access',
    status: 'pending',
    userName: 'Тимур Жакупов',
    userEmail: 't.zhakupov@buildtech.kz',
    subject: 'Запрос роли OWNER',
    description: 'Мне нужен доступ к Owner-панели для управления несколькими командами. Сейчас у меня роль MANAGER.',
    createdAt: '2026-03-26T10:00:00Z',
    company: 'BuildTech KZ',
  },
  {
    id: 'req-005',
    category: 'access',
    status: 'pending',
    userName: 'Сара Мусина',
    userEmail: 's.musina@agro-system.kz',
    subject: 'Доступ к модулю Analytics Pro',
    description: 'Хотим подключить расширенную аналитику и экспорт отчётов в PDF. Текущий план — базовый.',
    createdAt: '2026-03-25T16:45:00Z',
    company: 'AgroSystem',
  },
  {
    id: 'req-006',
    category: 'access',
    status: 'approved',
    userName: 'Бахыт Нургалиев',
    userEmail: 'b.nurgaliev@energo.kz',
    subject: 'Расширение лимита клиентов',
    description: 'Текущий план: 10 клиентов. Запрос на увеличение до 50.',
    createdAt: '2026-03-22T09:00:00Z',
    company: 'Energo KZ',
  },
  {
    id: 'req-007',
    category: 'support',
    status: 'pending',
    userName: 'Акмарал Тулегенова',
    userEmail: 'a.tulegenova@retail-plus.kz',
    subject: 'Ошибка при загрузке GRI-отчёта',
    description: 'При попытке пересчитать GRI-индекс для клиента ID-4521 получаю 500 Internal Server Error. Повторяется стабильно.',
    createdAt: '2026-03-26T08:00:00Z',
    company: 'Retail Plus',
  },
  {
    id: 'req-008',
    category: 'support',
    status: 'pending',
    userName: 'Ерлан Байжанов',
    userEmail: 'e.baijanov@medtech.kz',
    subject: 'Не приходит приглашение по email',
    description: 'Пригласил 3 коллег через панель команды — никто не получил письмо уже 2 часа.',
    createdAt: '2026-03-25T12:30:00Z',
    company: 'MedTech KZ',
  },
  {
    id: 'req-009',
    category: 'support',
    status: 'rejected',
    userName: 'Жанель Омарова',
    userEmail: 'zh.omarova@personal.kz',
    subject: 'Восстановление удалённых данных',
    description: 'Случайно удалила компанию. Можно ли восстановить данные из бэкапа?',
    createdAt: '2026-03-20T15:00:00Z',
    rejectionReason: 'Восстановление удалённых записей не предусмотрено текущей политикой. Рекомендуем создать заново.',
  },
]
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
