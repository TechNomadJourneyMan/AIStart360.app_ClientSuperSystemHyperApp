import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'

/**
 * GET /api/admin/users
 *
 * List all platform users with filtering and pagination.
 *
 * Query params:
 *   status  — active | blocked
 *   role    — SUPER_ADMIN | ADMIN | MANAGER | ANALYST | CLIENT
 *   search  — name or email (case-insensitive)
 *   page    — default 1
 *   limit   — default 30
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('users:read')
  if (error) return error

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const role = sp.get('role')
  const search = sp.get('search')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '30'))

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (role) where.role = role
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatarUrl: true,
        lastLogin: true,
        createdAt: true,
        org: { select: { id: true, name: true } },
        _count: { select: { submittedRequests: true, assignedRequests: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return NextResponse.json({
    data: users,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  })
}
