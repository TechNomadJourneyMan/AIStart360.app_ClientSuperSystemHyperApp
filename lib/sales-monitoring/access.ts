import { createClient } from '@/lib/supabase/server'
import { query } from './database'
import { DomainError } from './errors'

export type SalesPermission =
  | 'sales:read' | 'sales:write' | 'sales:post' | 'sales:reverse'
  | 'products:read' | 'products:write'
  | 'expenses:read' | 'expenses:write' | 'expenses:post' | 'expenses:reverse'
  | 'plans:read' | 'plans:write' | 'plans:publish'
  | 'approvals:decide'
  | 'analytics:read' | 'imports:write'
  | 'knowledge:read' | 'knowledge:write' | 'assistant:write' | 'audit:read'

const allPermissions: SalesPermission[] = [
  'sales:read', 'sales:write', 'sales:post', 'sales:reverse',
  'products:read', 'products:write',
  'expenses:read', 'expenses:write', 'expenses:post', 'expenses:reverse',
  'plans:read', 'plans:write', 'plans:publish',
  'approvals:decide',
  'analytics:read', 'imports:write',
  'knowledge:read', 'knowledge:write', 'assistant:write', 'audit:read',
]

const rolePermissions: Record<string, SalesPermission[]> = {
  owner: allPermissions,
  director: allPermissions,
  admin: allPermissions,
  super_admin: allPermissions,
  sales_head: [
    'sales:read', 'sales:write', 'sales:post', 'sales:reverse',
    'products:read', 'plans:read', 'plans:write', 'plans:publish',
    'approvals:decide', 'analytics:read', 'knowledge:read', 'assistant:write',
  ],
  sales_manager: [
    'sales:read', 'sales:write', 'sales:post', 'products:read',
    'analytics:read', 'knowledge:read', 'assistant:write',
  ],
  manager: [
    'sales:read', 'sales:write', 'sales:post', 'products:read',
    'analytics:read', 'knowledge:read', 'assistant:write',
  ],
  expert: [
    'sales:read', 'products:read', 'expenses:read', 'plans:read',
    'analytics:read', 'knowledge:read', 'assistant:write',
  ],
  finance_manager: [
    'sales:read', 'sales:reverse', 'products:read', 'products:write',
    'expenses:read', 'expenses:write', 'expenses:post', 'expenses:reverse',
    'plans:read', 'plans:write', 'plans:publish', 'analytics:read',
    'approvals:decide',
    'imports:write', 'knowledge:read', 'knowledge:write', 'assistant:write', 'audit:read',
  ],
  accountant: [
    'sales:read', 'products:read',
    'expenses:read', 'expenses:write', 'expenses:post',
    'plans:read', 'analytics:read', 'imports:write', 'knowledge:read',
  ],
  analyst: [
    'sales:read', 'products:read', 'expenses:read', 'plans:read',
    'analytics:read', 'knowledge:read', 'assistant:write',
  ],
  auditor: ['sales:read', 'expenses:read', 'plans:read', 'analytics:read', 'knowledge:read', 'audit:read'],
}

export function permissionsForSalesRole(role: string): SalesPermission[] {
  return rolePermissions[role] ?? []
}

export interface SalesAccessContext {
  actorId: string
  email: string
  role: string
  organizationId: string
  regionIds: string[] | null
  channelIds: string[] | null
}

export async function requireSalesPermission(
  organizationId: string,
  permission: SalesPermission,
): Promise<SalesAccessContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id || !user.email) {
    throw new DomainError('UNAUTHORIZED', 'Необходима авторизация', 401)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization')
    .eq('id', user.id)
    .maybeSingle()
  const profileRole = typeof profile?.role === 'string' ? profile.role : 'client'
  const profileOrganization = typeof profile?.organization === 'string'
    ? profile.organization.trim()
    : ''

  let assignments: Array<{
    role: string
    region_ids: string[] | null
    channel_ids: string[] | null
  }> = []
  try {
    assignments = await query(
      `SELECT role, region_ids, channel_ids
       FROM user_role_assignments
       WHERE organization_id = $1 AND user_id = $2::uuid
         AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
      [organizationId, user.id],
    )
  } catch (error) {
    console.warn('[sales-monitoring] role assignment lookup unavailable', error)
  }

  const effective = assignments.find((item) => rolePermissions[item.role]?.includes(permission))
  const globalLegacyRole = ['super_admin', 'admin'].includes(profileRole)
  let legacyScopeAllowed = globalLegacyRole
  if (!legacyScopeAllowed && profileOrganization) {
    const organizations = await query<{ id: string }>(
      `SELECT id FROM organizations
       WHERE id = $1 AND (id = $2 OR lower(name) = lower($2))
       LIMIT 1`,
      [organizationId, profileOrganization],
    )
    legacyScopeAllowed = Boolean(organizations[0])
  }
  const legacyAllowed =
    legacyScopeAllowed && rolePermissions[profileRole]?.includes(permission)
  if (!effective && !legacyAllowed) {
    throw new DomainError('FORBIDDEN', 'Недостаточно прав для операции', 403, { permission })
  }

  return {
    actorId: user.id,
    email: user.email,
    role: effective?.role ?? profileRole,
    organizationId,
    regionIds: effective?.region_ids ?? null,
    channelIds: effective?.channel_ids ?? null,
  }
}

export function assertScopedAccess(
  access: SalesAccessContext,
  regionId?: string | null,
  channelId?: string | null,
) {
  if (regionId && access.regionIds && !access.regionIds.includes(regionId)) {
    throw new DomainError('REGION_FORBIDDEN', 'Нет доступа к выбранному региону', 403)
  }
  if (channelId && access.channelIds && !access.channelIds.includes(channelId)) {
    throw new DomainError('CHANNEL_FORBIDDEN', 'Нет доступа к выбранному каналу', 403)
  }
}
