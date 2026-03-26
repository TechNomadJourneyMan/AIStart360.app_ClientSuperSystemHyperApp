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

// POST /api/clients/:id/gri/calculate
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  // We need to import inngest from lib/inngest
  // But lib/inngest.ts will be created in the next step.
  // I will assume it exists and the path is correct.
  const { inngest } = await import('@/lib/inngest')

  // Запустить фоновый расчёт
  await inngest.send({
    name: 'gri/calculate',
    data: { clientId: params.id },
  })

  return NextResponse.json({ message: 'GRI calculation queued' })
}
