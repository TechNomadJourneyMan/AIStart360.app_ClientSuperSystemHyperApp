import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'

export type SettingsUserData = {
  id: string
  name: string
  email: string
  role: string
  organizationName: string
}

type DbClient = PrismaClient | Prisma.TransactionClient

export async function getSettingsUserData(db: DbClient = prisma): Promise<SettingsUserData | null> {
  const cookieStore = await cookies()
  const userId = cookieStore.get('aistart360_user_id')?.value

  if (!userId) {
    return null
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { org: true },
  })

  if (!user) {
    return null
  }

  return {
    id: user.id,
    name: user.name ?? 'Пользователь',
    email: user.email,
    role: user.role,
    organizationName: user.org?.name ?? 'Не указана',
  }
}
