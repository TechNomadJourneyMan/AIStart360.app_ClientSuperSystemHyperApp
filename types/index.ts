// ============================================================
// Core Domain Types — AIStart360 Portal
// ============================================================

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'CLIENT'
export type ClientStatus = 'active' | 'at risk' | 'inactive' | 'onboarding'
export type GrowthStage = 'Seed' | 'Early' | 'Growth' | 'Scale' | 'Mature'
export type AlertSeverity = 'critical' | 'warning' | 'success' | 'info'
export type NotificationType = 'gri_updated' | 'report' | 'alert' | 'project' | 'team' | 'system'

// ============================================================
// User
// ============================================================

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  orgId: string
  avatarUrl?: string
  createdAt: string
  lastLogin?: string
}

// ============================================================
// Client
// ============================================================

export interface Client {
  id: string
  name: string
  industry: string
  stage: GrowthStage
  status: ClientStatus
  manager: string
  managerId: string
  griScore: number
  previousGriScore?: number
  website?: string
  createdAt: string
  lastActivity?: string
}

// ============================================================
// GRI
// ============================================================

export interface GriDomain {
  name: string
  score: number
  weight: number
  trend: number
  recommendations: string[]
}

export interface GriReport {
  id: string
  clientId: string
  score: number
  previousScore?: number
  domains: Record<string, number>
  calculatedAt: string
  version: string
  benchmarkScore?: number
}

// ============================================================
// Report (File)
// ============================================================

export interface Report {
  id: string
  clientId: string
  clientName: string
  name: string
  category: 'GRI' | 'Financial' | 'Growth' | 'Market' | 'Custom' | 'Intelligence' | 'Strategic' | 'AI' | 'Protocol'
  type: 'pdf' | 'xlsx' | 'csv' | 'docx'
  fileUrl: string
  fileSize: string
  uploadedBy: string
  uploadedAt: string
}

// ============================================================
// Activity
// ============================================================

export interface ActivityItem {
  id: string
  clientName: string
  industry: string
  event: string
  gri: number
  status: string
  time: string
}

// ============================================================
// Notification
// ============================================================

export interface Notification {
  id: string
  type: NotificationType
  title: string
  body: string
  read: boolean
  entityType?: string
  entityId?: string
  time: string
  createdAt: string
}

// ============================================================
// Alert
// ============================================================

export interface Alert {
  id: string
  severity: AlertSeverity
  title: string
  description: string
  time: string
  action?: { label: string; href: string }
}

// ============================================================
// Intelligence Signal
// ============================================================

export interface Signal {
  id: string
  title: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  type: 'market' | 'financial' | 'regulatory' | 'technology' | 'competitive'
  tags: string[]
  time: string
  relatedClient?: string
}

// ============================================================
// Team
// ============================================================

export interface TeamMember {
  id: string
  name: string
  role: string
  load: number
  clients: string[]
  email: string
}

// ============================================================
// UI
// ============================================================

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
}

export interface NavItem {
  label: string
  href: string
  icon: string
  roles: UserRole[]
  badge?: string
}

// ============================================================
// API Response wrappers
// ============================================================

export interface ApiResponse<T> {
  data: T
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, string[]>
}

// ============================================================
// Form Types
// ============================================================

export interface LoginFormData {
  email: string
  password: string
}

export interface CreateClientFormData {
  name: string
  industry: string
  stage: GrowthStage
  managerId: string
  website?: string
}
