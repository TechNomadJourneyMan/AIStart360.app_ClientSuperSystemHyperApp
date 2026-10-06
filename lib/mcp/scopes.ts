/**
 * lib/mcp/scopes.ts — scopes of the MCP server, derived from the platform roles.
 *
 * A scope is what a credential (personal token or OAuth access token) MAY be
 * used for. It is never a permission by itself: on every call the server
 * intersects the credential's scopes with the scopes the caller's CURRENT role
 * allows (`allowedScopes`), so a staff member whose role is revoked or
 * narrowed loses access immediately, whatever their tokens say.
 *
 * The role → scope mapping reuses the RBAC matrix of GIGA-CRM
 * (lib/admin/rbac.ts) — every scope names the existing permission(s) that
 * grant it — and the expert-portal rule of lib/expert-auth.ts / lib/admin/
 * user-data-access.ts: experts are company employees and read every CLIENT,
 * contacts included (the expert portal shows them), but not the platform's
 * agents, costs or staff data.
 *
 * Scope strings follow RFC 6749 §3.3 (scope-token = 1*NQCHAR) so they can be
 * requested in OAuth (MCP Authorization, «Scope Selection Strategy»:
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#scope-selection-strategy).
 */
import { hasPermission, type Permission, type StaffRole } from '@/lib/admin/rbac'

export const MCP_SCOPES = [
  'clients:read',
  'clients:pii',
  'diagnostics:read',
  'metrics:read',
  'reports:read',
  'agents:read',
  'spend:read',
] as const
export type McpScope = (typeof MCP_SCOPES)[number]

interface ScopeDef {
  /** Russian label for the consent screen, GIGA and the bot. */
  label: string
  /** What the scope lets a client do, one sentence (Russian). */
  description: string
  /** Staff: ANY of these permissions grants the scope. */
  anyOf: Permission[]
  /** Experts (non-staff, profiles.role in EXPERT_PROFILE_ROLES) get it. */
  expert: boolean
}

export const SCOPE_DEFS: Record<McpScope, ScopeDef> = {
  'clients:read': {
    label: 'Клиенты: поиск и карточка',
    description: 'Поиск клиентов и карточка клиента с данными компании (контакты скрыты без отдельного права).',
    anyOf: ['users.view'],
    expert: true,
  },
  'clients:pii': {
    label: 'Клиенты: контакты (персональные данные)',
    description: 'Email и телефоны клиентов без маскировки.',
    anyOf: ['users.sensitive'],
    expert: true,
  },
  'diagnostics:read': {
    label: 'Диагностика и Точка А',
    description: 'Точка А, диагностики и сессии диагностики компании.',
    anyOf: ['users.view'],
    expert: true,
  },
  'metrics:read': {
    label: 'Метрики компании',
    description: 'Текущие значения метрик компании с источником и периодом.',
    anyOf: ['users.view'],
    expert: true,
  },
  'reports:read': {
    label: 'Опубликованные отчёты',
    description: 'Список опубликованных версий отчётов (черновики не видны).',
    anyOf: ['agents.view', 'users.view'],
    expert: true,
  },
  'agents:read': {
    label: 'Задачи ИИ-агентов',
    description: 'Задачи агентов: статус, попытки, ошибки, стоимость.',
    anyOf: ['agents.view'],
    expert: false,
  },
  'spend:read': {
    label: 'Расходы на ИИ',
    description: 'Расходы на ИИ по провайдерам, моделям, функциям и компаниям.',
    anyOf: ['agents.view'],
    expert: false,
  },
}

/**
 * Profile roles admitted as experts — the same set lib/expert-auth.ts admits to
 * the expert portal (EXPERT_ROLES; a test keeps them equal). super_admin is
 * resolved as staff first.
 */
export const EXPERT_PROFILE_ROLES: ReadonlySet<string> = new Set(['expert', 'admin', 'super_admin'])

/** Who is calling: GIGA staff (RBAC role) or an expert (profiles.role). */
export type McpRole = { kind: 'staff'; staffRole: StaffRole } | { kind: 'expert'; profileRole: string }

export function isMcpScope(v: unknown): v is McpScope {
  return typeof v === 'string' && (MCP_SCOPES as readonly string[]).includes(v)
}

/** Scopes the role allows right now, in MCP_SCOPES order. */
export function allowedScopes(role: McpRole): McpScope[] {
  return MCP_SCOPES.filter((s) => {
    const def = SCOPE_DEFS[s]
    if (role.kind === 'expert') return def.expert
    return def.anyOf.some((p) => hasPermission(role.staffRole, p))
  })
}

/** Space-separated scope string (RFC 6749 §3.3) → known scopes, or null if any is unknown. */
export function parseScopeString(raw: string | null | undefined): McpScope[] | null {
  if (raw === null || raw === undefined) return []
  const parts = raw.split(' ').filter(Boolean)
  const out: McpScope[] = []
  for (const p of parts) {
    if (!isMcpScope(p)) return null
    if (!out.includes(p)) out.push(p)
  }
  return MCP_SCOPES.filter((s) => out.includes(s))
}

/** Normalise a list (dedupe, canonical order); null when it holds an unknown scope. */
export function normalizeScopes(list: readonly unknown[]): McpScope[] | null {
  if (!list.every(isMcpScope)) return null
  return MCP_SCOPES.filter((s) => list.includes(s))
}

export function intersectScopes(a: readonly string[], b: readonly string[]): McpScope[] {
  return MCP_SCOPES.filter((s) => a.includes(s) && b.includes(s))
}

export function scopeString(scopes: readonly string[]): string {
  return MCP_SCOPES.filter((s) => scopes.includes(s)).join(' ')
}

export function scopeLabel(s: string): string {
  return isMcpScope(s) ? SCOPE_DEFS[s].label : s
}
