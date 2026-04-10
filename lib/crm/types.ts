// ─── Unified CRM Interface ──────────────────────────────────────────────────

export type CrmProvider = 'bitrix24' | 'amocrm'

export interface CrmDeal {
  id: string
  title: string
  amount: number
  currency: string
  stage: string
  stageSemantic?: string  // P=in progress, S=success, F=fail
  createdAt: string
  updatedAt: string
  closeDate?: string | null
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  comment?: string
}

export interface CrmContact {
  id: string
  name: string
  email?: string
  phone?: string
  company?: string
  createdAt: string
}

export interface CrmSyncResult {
  success: boolean
  deals: number
  contacts: number
  errors: string[]
  syncedAt: string
}

export interface CrmConnectionConfig {
  provider: CrmProvider
  domain: string
  accessToken: string
  refreshToken?: string
  webhookUrl?: string
}

export interface CrmStatus {
  id: string
  provider: CrmProvider
  domain: string
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  syncedDeals: number
  syncedContacts: number
  createdAt: string
}
