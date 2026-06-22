export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'

/**
 * POST /api/crm/sync — trigger sync for a CRM integration
 * Body: { id }
 */
export async function POST(req: NextRequest) {
  try {
    const { session, error } = await requireAuth()
    if (error) return error

    const orgId = (session!.user as any).orgId as string | undefined
    if (!orgId) {
      return NextResponse.json({ error: 'No organization' }, { status: 403 })
    }

    const { id } = await req.json() as { id: string }

    // Scope to the caller's org so a guessed id cannot sync another tenant's CRM.
    const integration = await prisma.crmIntegration.findFirst({ where: { id, orgId } })
    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const config = {
      domain: integration.domain,
      accessToken: integration.accessToken,
      webhookUrl: integration.webhookUrl || undefined,
    }

    const result = integration.provider === 'bitrix24'
      ? await bitrix24.syncAll(config)
      : await amocrm.syncAll(config)

    // Update integration record
    await prisma.crmIntegration.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: result.success ? 'success' : (result.errors.length > 0 ? 'partial' : 'error'),
        lastSyncError: result.errors.length > 0 ? result.errors.join('; ') : null,
        syncedDeals: result.deals,
        syncedContacts: result.contacts,
      },
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('[crm/sync] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
