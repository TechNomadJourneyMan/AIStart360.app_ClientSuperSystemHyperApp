import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, isStaffRole } from '@/lib/api-utils'

// GET /api/clients/:id/gri
// Returns the GRI report history for a client. Authorized only for org-scoped
// staff; 404 (not 403) on missing/cross-tenant to avoid id enumeration.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error

  const role = (session!.user as any).role as string | undefined
  const orgId = (session!.user as any).orgId as string | undefined

  const parent = await prisma.client.findUnique({
    where: { id: params.id },
    select: { orgId: true },
  })
  if (!parent || !isStaffRole(role) || !orgId || parent.orgId !== orgId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const reports = await prisma.griReport.findMany({
    where: { clientId: params.id },
    orderBy: { calculatedAt: 'desc' },
    take: 10,
  })

  return NextResponse.json(reports)
}
