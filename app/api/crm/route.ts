export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'

/**
 * GET /api/crm — list all CRM integrations for the current org
 */
export async function GET() {
  try {
    const integrations = await prisma.crmIntegration.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        domain: true,
        isActive: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
        syncedDeals: true,
        syncedContacts: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ integrations })
  } catch (error) {
    console.error('[crm] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/crm — connect a new CRM
 * Body: { provider, domain, accessToken, webhookUrl? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      provider: 'bitrix24' | 'amocrm'
      domain: string
      accessToken: string
      webhookUrl?: string
    }

    if (!body.provider || !body.domain || !body.accessToken) {
      return NextResponse.json({ error: 'provider, domain, accessToken required' }, { status: 400 })
    }

    // Test connection first
    const config = { domain: body.domain, accessToken: body.accessToken, webhookUrl: body.webhookUrl }
    const testResult = body.provider === 'bitrix24'
      ? await bitrix24.testConnection(config)
      : await amocrm.testConnection(config)

    if (!testResult.ok) {
      return NextResponse.json({ error: testResult.error || 'Connection failed' }, { status: 400 })
    }

    // Find or create org (use first org for now)
    let org = await prisma.organization.findFirst()
    if (!org) {
      org = await prisma.organization.create({
        data: { name: 'Default', slug: 'default' },
      })
    }

    // Upsert integration
    const integration = await prisma.crmIntegration.upsert({
      where: {
        orgId_provider: { orgId: org.id, provider: body.provider },
      },
      update: {
        domain: body.domain,
        accessToken: body.accessToken,
        webhookUrl: body.webhookUrl || null,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        orgId: org.id,
        provider: body.provider,
        domain: body.domain,
        accessToken: body.accessToken,
        webhookUrl: body.webhookUrl || null,
      },
    })

    return NextResponse.json({
      ok: true,
      integration: {
        id: integration.id,
        provider: integration.provider,
        domain: integration.domain,
        isActive: integration.isActive,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[crm] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/crm — disconnect CRM
 * Body: { id }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json() as { id: string }
    await prisma.crmIntegration.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[crm] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
