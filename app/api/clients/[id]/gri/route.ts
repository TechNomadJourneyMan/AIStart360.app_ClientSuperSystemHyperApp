import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

// GET /api/clients/:id/gri
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const reports = await prisma.griReport.findMany({
    where: { clientId: params.id },
    orderBy: { calculatedAt: 'desc' },
    take: 10,
  })

  return NextResponse.json(reports)
}
