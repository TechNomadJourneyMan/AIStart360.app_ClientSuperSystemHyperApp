export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * GET /api/giga-admin/clients/:id
 * Full client profile: all GRI reports, pulse history, manager details.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true, avatarUrl: true } },
      griReports: { orderBy: { calculatedAt: 'desc' }, take: 5 },
      pulseMetrics: true,
      org: { select: { id: true, name: true } },
    },
  })

  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ client })
}
