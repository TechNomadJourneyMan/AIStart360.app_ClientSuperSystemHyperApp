export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

function mapStatus(s: string): 'pending' | 'approved' | 'rejected' | 'archived' {
  if (s === 'approved') return 'approved'
  if (s === 'rejected') return 'rejected'
  if (s === 'archived') return 'archived'
  return 'pending' // new | in_review | waiting_for_info | escalated
}

/**
 * GET /api/giga-admin/requests
 * Returns all AdminRequest records from Supabase via Prisma.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const rows = await prisma.adminRequest.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        company: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const requests = rows.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, string>
      return {
        id: r.id,
        category: r.type.toLowerCase() as 'registration' | 'access' | 'support',
        status: mapStatus(r.status),
        userName: r.user?.name ?? payload.name ?? 'Неизвестный',
        userEmail: r.user?.email ?? payload.email ?? '—',
        userAvatar: r.user?.avatarUrl ?? undefined,
        subject: payload.subject ?? `Заявка #${r.id.slice(-6)}`,
        description: payload.description ?? payload.message ?? '',
        createdAt: r.createdAt.toISOString(),
        company: r.company?.name ?? payload.company ?? undefined,
        rejectionReason: r.rejectionReason ?? undefined,
        priority: r.priority,
        assignedAdmin: r.assignedAdmin?.name ?? null,
        source: r.source ?? null,
      }
    })

    return NextResponse.json({ requests })
  } catch (error) {
    console.error('[giga-admin/requests] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/giga-admin/requests
 * Creates a new AdminRequest (used when seeding or from client portal).
 */
export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const request = await prisma.adminRequest.create({
      data: {
        type: body.type ?? 'registration',
        status: 'new',
        priority: body.priority ?? 'medium',
        payload: body.payload ?? {},
        source: body.source ?? 'manual',
      },
    })
    return NextResponse.json({ request }, { status: 201 })
  } catch (error) {
    console.error('[giga-admin/requests] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
