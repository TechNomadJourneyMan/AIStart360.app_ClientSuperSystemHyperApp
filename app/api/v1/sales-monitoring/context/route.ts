import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/sales-monitoring/database'
import { DomainError, errorResponse } from '@/lib/sales-monitoring/errors'
import { permissionsForSalesRole } from '@/lib/sales-monitoring/access'

export const dynamic = 'force-dynamic'

interface Assignment {
  organization_id: string
  role: string
  region_ids: string[] | null
  channel_ids: string[] | null
}

interface Organization {
  id: string
  name: string
  currency: string
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) throw new DomainError('UNAUTHORIZED', 'Необходима авторизация', 401)

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization')
      .eq('id', user.id)
      .maybeSingle()
    const profileRole = typeof profile?.role === 'string' ? profile.role : 'client'
    const profileOrganization = typeof profile?.organization === 'string'
      ? profile.organization.trim()
      : ''

    let assignments: Assignment[] = []
    try {
      assignments = await query<Assignment>(
        `SELECT organization_id, role, region_ids, channel_ids
         FROM user_role_assignments
         WHERE user_id = $1::uuid AND valid_from <= now()
           AND (valid_to IS NULL OR valid_to > now())`,
        [user.id],
      )
    } catch (error) {
      console.warn('[sales-monitoring] context assignments unavailable', error)
    }

    const isGlobalAdmin = ['super_admin', 'admin'].includes(profileRole)
    let organizations: Organization[]
    if (isGlobalAdmin) {
      organizations = await query<Organization>(
        `SELECT o.id, o.name, COALESCE(s.base_currency, 'KZT') AS currency
         FROM organizations o
         LEFT JOIN organization_sales_settings s ON s.organization_id = o.id
         ORDER BY o.name`,
      )
    } else if (assignments.length) {
      organizations = await query<Organization>(
        `SELECT o.id, o.name, COALESCE(s.base_currency, 'KZT') AS currency
         FROM organizations o
         LEFT JOIN organization_sales_settings s ON s.organization_id = o.id
         WHERE o.id = ANY($1::text[])
         ORDER BY o.name`,
        [assignments.map((item) => item.organization_id)],
      )
    } else if (profileOrganization) {
      organizations = await query<Organization>(
        `SELECT o.id, o.name, COALESCE(s.base_currency, 'KZT') AS currency
         FROM organizations o
         LEFT JOIN organization_sales_settings s ON s.organization_id = o.id
         WHERE o.id = $1 OR lower(o.name) = lower($1)
         ORDER BY o.name`,
        [profileOrganization],
      )
    } else {
      organizations = []
    }

    const organizationIds = organizations.map((item) => item.id)
    const [regions, channels, categories, costCenters] = organizationIds.length
      ? await Promise.all([
        query<{ id: string; organization_id: string; name: string }>(
          `SELECT id, organization_id, name FROM sales_regions
           WHERE organization_id = ANY($1::text[]) AND archived_at IS NULL ORDER BY name`,
          [organizationIds],
        ),
        query<{ id: string; organization_id: string; name: string }>(
          `SELECT id, organization_id, name FROM sales_channels
           WHERE organization_id = ANY($1::text[]) AND archived_at IS NULL ORDER BY name`,
          [organizationIds],
        ),
        query<{ id: string; organization_id: string; name: string }>(
          `SELECT id, organization_id, name FROM expense_categories
           WHERE organization_id = ANY($1::text[]) AND archived_at IS NULL ORDER BY name`,
          [organizationIds],
        ),
        query<{ id: string; organization_id: string; name: string }>(
          `SELECT id, organization_id, name FROM cost_centers
           WHERE organization_id = ANY($1::text[]) AND archived_at IS NULL ORDER BY name`,
          [organizationIds],
        ),
      ])
      : [[], [], [], []]

    return Response.json({
      data: {
        actor: { id: user.id, email: user.email, profileRole },
        organizations: organizations.map((organization) => {
          const assignment = assignments.find((item) => item.organization_id === organization.id)
          const role = assignment?.role ?? profileRole
          return {
            ...organization,
            role,
            permissions: permissionsForSalesRole(role),
            regionIds: assignment?.region_ids ?? null,
            channelIds: assignment?.channel_ids ?? null,
          }
        }),
        regions,
        channels,
        categories,
        costCenters,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
