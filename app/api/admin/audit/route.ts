export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'

/**
 * GET /api/admin/audit
 *
 * Query the immutable audit log. Only SUPER_ADMIN has access.
 *
 * Query params:
 *   entityType  — request | user | company
 *   entityId    — specific entity ID
 *   performedBy — admin user ID
 *   action      — filter by action string
 *   from        — ISO date (createdAt >= from)
 *   to          — ISO date (createdAt <= to)
 *   page        — default 1
 *   limit       — default 50, max 200
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('audit:read')
  if (error) return error

  const sp = req.nextUrl.searchParams
  const entityType = sp.get('entityType')
  const entityId = sp.get('entityId')
  const performedBy = sp.get('performedBy')
  const action = sp.get('action')
  const from = sp.get('from')
  const to = sp.get('to')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'))

  const where: Record<string, unknown> = {}
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  if (performedBy) where.performedBy = performedBy
  if (action) where.action = { contains: action }
  if (from || to) {
    where.timestamp = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  // performedBy is a plain actor identifier (migration 059) — a Prisma users.id
  // for legacy /api/admin actors, a profiles UUID for personal admin sessions,
  // or 'giga:super_admin' for break-glass. Join to users manually where it
  // matches so the response keeps the old `performer` shape (null otherwise).
  const actorIds = Array.from(new Set(logs.map((l) => l.performedBy)))
  const performers = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : []
  const byId = new Map(performers.map((u) => [u.id, u]))
  const data = logs.map((l) => ({ ...l, performer: byId.get(l.performedBy) ?? null }))

  return NextResponse.json({
    data,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  })
}
