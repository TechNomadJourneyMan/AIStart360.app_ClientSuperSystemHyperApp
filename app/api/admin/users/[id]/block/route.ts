import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { auditUserBlock } from '@/lib/audit'

/**
 * POST /api/admin/users/:id/block
 * Body: { block: boolean }  — true = block, false = unblock
 *
 * Blocking: sets user.status = "blocked" AND deletes all active sessions
 * (immediate logout from all devices).
 *
 * Unblocking: sets user.status = "active".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requirePermission('users:write')
  if (error) return error

  const body = await req.json()
  const block: boolean = body.block !== false // default: block

  // Prevent self-block
  if (params.id === session.user.id) {
    return NextResponse.json({ error: 'Cannot block your own account' }, { status: 422 })
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Prevent blocking a SUPER_ADMIN unless you are one too
  if (target.role === 'SUPER_ADMIN' && session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Cannot block a SUPER_ADMIN' }, { status: 403 })
  }

  const ops: Promise<unknown>[] = [
    prisma.user.update({
      where: { id: params.id },
      data: { status: block ? 'blocked' : 'active' },
    }),
  ]

  // Immediately invalidate all sessions on block
  if (block) {
    ops.push(prisma.session.deleteMany({ where: { userId: params.id } }))
  }

  await Promise.all(ops)
  await auditUserBlock(params.id, session.user.id, block)

  return NextResponse.json({
    message: block ? 'User blocked and sessions invalidated' : 'User unblocked',
    userId: params.id,
    status: block ? 'blocked' : 'active',
  })
}
