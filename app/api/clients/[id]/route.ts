import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

// GET /api/clients/:id
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      griReports: { orderBy: { calculatedAt: 'desc' }, take: 5 },
      reports: { orderBy: { uploadedAt: 'desc' }, take: 10 },
      projects: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json(client)
}

// PATCH /api/clients/:id
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const body = await request.json()

  const client = await prisma.client.update({
    where: { id: params.id },
    data: body,
  })

  return NextResponse.json(client)
}

// DELETE /api/clients/:id — soft delete
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  await prisma.client.update({
    where: { id: params.id },
    data: { status: 'inactive' },
  })

  return NextResponse.json({ success: true })
}
