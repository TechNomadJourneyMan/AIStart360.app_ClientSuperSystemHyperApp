import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/api-utils'

export async function PATCH() {
  const { session, error } = await requireAuth()
  if (error) return error

  await prisma.notification.updateMany({
    where: { userId: session!.user!.id!, isRead: false },
    data: { isRead: true },
  })

  return NextResponse.json({ success: true })
}
