import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

// GET /api/notifications
export async function GET(request: Request) {
  const { session, error } = await requireAuth()
  if (error) return error

  const userId = session!.user!.id!
  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly && { isRead: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(notifications)
}
