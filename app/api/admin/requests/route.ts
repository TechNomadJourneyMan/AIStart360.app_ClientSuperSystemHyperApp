import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission, SLA_HOURS } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import type { AdminRequestStatus, AdminRequestType, RequestPriority } from '@prisma/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INCLUDE_FULL = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
  company: { select: { id: true, name: true, domain: true, status: true } },
  assignedAdmin: { select: { id: true, name: true, email: true, avatarUrl: true } },
  _count: { select: { comments: true } },
} as const

// ─── GET /api/admin/requests ──────────────────────────────────────────────────

/**
 * List admin requests with filtering, sorting, and pagination.
 *
 * Query params:
 *   status  — new | in_review | waiting_for_info | approved | rejected | escalated
 *   type    — registration | access | support
 *   priority — low | medium | high | critical
 *   assignedAdminId — filter by assignee
 *   search  — email or company name (icontains)
 *   page    — default 1
 *   limit   — default 20, max 100
 *   sortBy  — createdAt | priority | slaDeadline (default: createdAt)
 *   sortDir — asc | desc (default: desc)
 *   overdue — "true" → only past-SLA requests
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('requests:read')
  if (error) return error

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') as AdminRequestStatus | null
  const type = sp.get('type') as AdminRequestType | null
  const priority = sp.get('priority') as RequestPriority | null
  const assignedAdminId = sp.get('assignedAdminId')
  const search = sp.get('search')
  const overdue = sp.get('overdue') === 'true'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '20')))
  const sortBy = (sp.get('sortBy') ?? 'createdAt') as 'createdAt' | 'priority' | 'slaDeadline'
  const sortDir = (sp.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (type) where.type = type
  if (priority) where.priority = priority
  if (assignedAdminId) where.assignedAdminId = assignedAdminId
  if (overdue) where.slaDeadline = { lt: new Date() }
  if (search) {
    where.OR = [
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { company: { name: { contains: search, mode: 'insensitive' } } },
      { payload: { path: ['email'], string_contains: search } },
    ]
  }

  const [total, requests] = await Promise.all([
    prisma.adminRequest.count({ where }),
    prisma.adminRequest.findMany({
      where,
      include: INCLUDE_FULL,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return NextResponse.json({
    data: requests,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  })
}

// ─── POST /api/admin/requests ─────────────────────────────────────────────────

/**
 * Create a new admin request manually (e.g. from the admin panel on behalf of a user).
 *
 * Body: { type, priority?, userId?, companyId?, source?, payload }
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('requests:write')
  if (error) return error

  const body = await req.json()
  const { type, priority = 'medium', userId, companyId, source = 'manual', payload } = body

  if (!type || !['registration', 'access', 'support'].includes(type)) {
    return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
  }

  // Calculate SLA deadline based on priority
  const slaHours = SLA_HOURS[priority as string] ?? 24
  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000)

  const request = await prisma.adminRequest.create({
    data: {
      type,
      priority,
      userId: userId ?? null,
      companyId: companyId ?? null,
      source,
      payload: payload ?? {},
      slaDeadline,
    },
    include: INCLUDE_FULL,
  })

  await logAudit({
    entityType: 'request',
    entityId: request.id,
    action: 'request.created',
    performedBy: session.user.id,
    diff: { after: { type, priority, source } },
  })

  return NextResponse.json({ data: request }, { status: 201 })
}
