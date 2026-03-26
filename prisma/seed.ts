import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Создать организацию
  const org = await prisma.organization.upsert({
    where: { slug: 'aistart360' },
    create: { name: 'AIStart360', slug: 'aistart360', plan: 'growth' },
    update: {},
  })

  // Создать admin пользователя
  const passwordHash = await bcrypt.hash('Admin1234!', 12)
  await prisma.user.upsert({
    where: { email: 'admin@aistart360.com' },
    create: {
      email: 'admin@aistart360.com',
      passwordHash,
      name: 'Admin User',
      role: 'ADMIN',
      orgId: org.id,
    },
    update: {},
  })

  // Создать тестового manager
  const manager = await prisma.user.upsert({
    where: { email: 'manager@aistart360.com' },
    create: {
      email: 'manager@aistart360.com',
      passwordHash: await bcrypt.hash('Manager1234!', 12),
      name: 'Alex Kim',
      role: 'MANAGER',
      orgId: org.id,
    },
    update: {},
  })

  // Создать тестовых клиентов
  for (const c of [
    { name: 'Vortex Labs', industry: 'FinTech', stage: 'Scale' as const },
    { name: 'Calyx Digital', industry: 'E-commerce', stage: 'Growth' as const },
    { name: 'Nexum Systems', industry: 'SaaS', stage: 'Growth' as const },
  ]) {
    await prisma.client.upsert({
      where: { id: `test-${c.name.toLowerCase().replace(/\s+/g, '-')}` },
      create: {
        id: `test-${c.name.toLowerCase().replace(/\s+/g, '-')}`,
        ...c,
        orgId: org.id,
        managerId: manager.id
      },
      update: {}
    })
  }

  console.log('✅ Seed completed')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
