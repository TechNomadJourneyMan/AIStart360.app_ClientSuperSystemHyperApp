export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/companies
 * Query: status (lead|active|blocked), search, page, limit
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('companies:read')
  if (error) return error

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const search = sp.get('search')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '20'))

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { domain: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      include: {
        _count: { select: { requests: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return NextResponse.json({
    data: companies,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  })
}

/**
 * POST /api/admin/companies
 * Body: { name, domain?, notes? }
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('companies:write')
  if (error) return error

  const body = await req.json()
  const { name, domain, notes } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  const company = await prisma.company.create({
    data: { name: name.trim(), domain: domain ?? null, notes: notes ?? null },
  })

  await logAudit({
    entityType: 'company',
    entityId: company.id,
    action: 'company.created',
    performedBy: session.user.id,
    diff: { after: { name, domain } },
  })

  return NextResponse.json({ data: company }, { status: 201 })
}
