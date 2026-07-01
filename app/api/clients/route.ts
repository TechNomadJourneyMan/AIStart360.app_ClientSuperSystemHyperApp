import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'
import { z } from 'zod'

// GET /api/clients
export async function GET(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const page   = parseInt(searchParams.get('page')  ?? '1')
  const limit  = parseInt(searchParams.get('limit') ?? '20')
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status')
  const orgId  = (session!.user as any).orgId

  const where = {
    orgId,
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    ...(status && { status: status as any }),
  }

  try {
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true } },
          griReports: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
            select: { score: true, calculatedAt: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.count({ where }),
    ])

    return NextResponse.json({ data: clients, meta: { total, page, limit } })
  } catch (err) {
    console.error('[api/clients GET]', err)
    return NextResponse.json({ error: 'Failed to load clients' }, { status: 500 })
  }
}

// POST /api/clients
const createSchema = z.object({
  name:      z.string().min(2),
  industry:  z.string(),
  stage:     z.enum(['Seed', 'Early', 'Growth', 'Scale', 'Mature']),
  managerId: z.string(),
  website:   z.string().url().optional(),
})

export async function POST(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const orgId = (session!.user as any).orgId

  try {
    const client = await prisma.client.create({
      data: {
        ...parsed.data,
        orgId,
      },
    })

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    console.error('[api/clients POST]', err)
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
}
