export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'

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
 * Reconcile orphaned Supabase profiles that have no matching AdminRequest.
 * This catches cases where /api/client/register failed after Supabase user creation.
 */
async function reconcileOrphanedProfiles(existingUserIds: Set<string>) {
  try {
    const supabase = createServerClient()

    // Find pending client profiles older than 60 seconds
    const cutoff = new Date(Date.now() - 60_000).toISOString()
    const { data: pendingProfiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, organization, created_at')
      .eq('status', 'pending_approval')
      .eq('role', 'client')
      .lt('created_at', cutoff)

    if (!pendingProfiles?.length) return 0

    let reconciled = 0
    for (const profile of pendingProfiles) {
      if (existingUserIds.has(profile.id)) continue

      try {
        await prisma.adminRequest.create({
          data: {
            type: 'registration',
            status: 'new',
            priority: 'medium',
            source: 'reconciliation',
            payload: {
              userId: profile.id,
              email: profile.email,
              name: profile.full_name || profile.email,
              company: profile.organization || '',
              subject: `Регистрация: ${profile.full_name || profile.email}`,
              description: `Авто-восстановленная заявка от ${profile.full_name || profile.email}`,
            },
          },
        })
        reconciled++
      } catch {
        // Skip duplicates or other errors
      }
    }

    if (reconciled > 0) {
      console.log(`[giga-admin/requests] Reconciled ${reconciled} orphaned profile(s)`)
    }
    return reconciled
  } catch (error) {
    console.warn('[giga-admin/requests] Reconciliation error:', error)
    return 0
  }
}

/**
 * GET /api/giga-admin/requests
 * Returns all AdminRequest records. Auto-reconciles orphaned Supabase profiles.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Collect existing userIds from AdminRequest payloads for reconciliation
    const allRows = await prisma.adminRequest.findMany({
      select: { payload: true },
    })
    const existingUserIds = new Set<string>()
    for (const r of allRows) {
      const uid = (r.payload as Record<string, string> | null)?.userId
      if (uid) existingUserIds.add(uid)
    }

    // Auto-reconcile orphaned profiles (non-blocking)
    await reconcileOrphanedProfiles(existingUserIds)

    // Fetch full data
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
