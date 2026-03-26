import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // 1. Create Default Org
  const org = await prisma.organization.upsert({
    where: { slug: 'aistart360' },
    update: {},
    create: {
      name: 'AIStart360',
      slug: 'aistart360',
    },
  })

  // 2. Create Admin User
  const admin = await prisma.user.upsert({
    where: { email: 'admin@aistart360.com' },
    update: {},
    create: {
      email: 'admin@aistart360.com',
      name: 'Adil',
      passwordHash: await bcrypt.hash('Admin123!', 12),
      orgId: org.id,
      role: 'ADMIN',
    },
  })

  // 3. Create Clients from the screenshot
  const clientsData = [
    {
      name: 'КазМунайГаз', sector: 'Нефть и газ', forbesRank: 1,
      metrics: {
        lastOrder: new Date('2026-01-26'), daysSince: 28, avgCheck: 48500000,
        volumeChange: -42, riskScore: 94, churnProb: 87, churnLevel: 'high',
        comment: 'Менеджер не выходил на связь 18 дней. Срочно требуется эскалация.',
        action: 'call', history: [48500, 46000, 42000, 37000, 28000]
      }
    },
    {
      name: 'Kaspi.kz', sector: 'FinTech / E-commerce', forbesRank: 2,
      metrics: {
        lastOrder: new Date('2026-01-15'), daysSince: 39, avgCheck: 32000000,
        volumeChange: -55, riskScore: 91, churnProb: 83, churnLevel: 'high',
        comment: 'Не отвечает на запросы 3 недели. Конкурент предложил условия лучше.',
        action: 'call', history: [32000, 28500, 24000, 19000, 14400]
      }
    },
    // Add more if needed...
  ]

  for (const item of clientsData) {
    const client = await prisma.client.create({
      data: {
        name: item.name,
        industry: item.sector,
        sector: item.sector,
        stage: 'Scale',
        orgId: org.id,
        managerId: admin.id,
        forbesRank: item.forbesRank,
        pulseMetrics: {
          create: item.metrics
        }
      }
    })
  }

  console.log('Seed completed successfully')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
