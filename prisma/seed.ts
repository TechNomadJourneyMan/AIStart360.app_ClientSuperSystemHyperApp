import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Clearing existing data...')
  await prisma.pulseMetric.deleteMany()
  await prisma.griReport.deleteMany()
  await prisma.client.deleteMany()
  await prisma.user.deleteMany()
  await prisma.organization.deleteMany()
  console.log('Data cleared.')

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

  // 3. Create Manager Alex
  const manager = await prisma.user.upsert({
    where: { email: 'alex@aistart360.com' },
    update: {},
    create: {
      email: 'alex@aistart360.com',
      name: 'Alex Kim',
      passwordHash: await bcrypt.hash('Manager123!', 12),
      orgId: org.id,
      role: 'MANAGER',
    },
  })

  // 4. Create ChocoFamily Org
  const chocoOrg = await prisma.organization.upsert({
    where: { slug: 'chocofamily' },
    update: {},
    create: {
      name: 'ChocoFamily Enterprise',
      slug: 'chocofamily',
    },
  })

  // 5. Create ChocoFamily Client Account
  const chocoUser = await prisma.user.upsert({
    where: { email: 'portal@chocofamily.kz' },
    update: { orgId: chocoOrg.id },
    create: {
      email: 'portal@chocofamily.kz',
      name: 'ChocoFamily CEO',
      passwordHash: await bcrypt.hash('ChocoFamily2026!', 12),
      orgId: chocoOrg.id,
      role: 'CLIENT',
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
        managerId: manager.id,
        forbesRank: item.forbesRank,
        pulseMetrics: {
          create: item.metrics
        }
      }
    })
  }

  // 6. Create ChocoFamily Holding specific record
  const chocoClient = await prisma.client.create({
    data: {
      name: 'ChocoFamily Holding',
      industry: 'E-commerce / FoodTech',
      sector: 'IT Holding',
      stage: 'Scale',
      status: 'active',
      orgId: chocoOrg.id,
      managerId: manager.id,
      website: 'chocofamily.kz',
      griReports: {
        create: {
          score: 5.2,
          productScore: 6.2,
          trustScore: 4.8,
          businessModelScore: 5.5,
          cashScore: 4.2,
          operationsScore: 7.1,
          teamScore: 6.8,
          founderScore: 5.8
        }
      },
      pulseMetrics: {
        create: {
          lastOrder: new Date('2026-03-28'),
          daysSince: 2,
          avgCheck: 154000,
          volumeChange: -24.1,
          riskScore: 65,
          churnProb: 45,
          churnLevel: 'medium',
          comment: 'Strategic pivot to B2B SaaS and AI Research. Refocusing after asset sales.',
          action: 'monitor',
          history: [154000, 162000, 185000, 204000, 215000]
        }
      }
    }
  })

  // 7. Seed FinancialSnapshots for AIStart360 org (default)
  const snapshots = [
    {
      orgId: org.id,
      period: 'Q4-2025',
      revenueKzt: 74.8,
      marginPct: 31.8,
      clientsCount: 42,
      expensesKzt: 51.0,
      revenueChange: 9.2,
      marginChange: 1.4,
      clientsChange: 5,
      expensesChange: 6.8,
      recordedAt: new Date('2026-01-01'),
    },
    {
      orgId: org.id,
      period: 'Q1-2026',
      revenueKzt: 84.2,
      marginPct: 34.2,
      clientsCount: 48,
      expensesKzt: 55.4,
      revenueChange: 12.4,
      marginChange: 2.1,
      clientsChange: 6,
      expensesChange: 8.2,
      recordedAt: new Date('2026-04-01'),
    },
  ]

  for (const snap of snapshots) {
    await prisma.financialSnapshot.upsert({
      where: { id: `snap-${snap.orgId}-${snap.period}` },
      update: snap,
      create: { id: `snap-${snap.orgId}-${snap.period}`, ...snap },
    })
  }

  // 8. Seed FinancialSnapshots for ChocoFamily org
  const chocoSnaps = [
    {
      orgId: chocoOrg.id,
      period: 'Q4-2025',
      revenueKzt: 68.4,
      marginPct: 29.5,
      clientsCount: 38,
      expensesKzt: 48.2,
      revenueChange: 7.8,
      marginChange: 1.1,
      clientsChange: 4,
      expensesChange: 5.9,
      recordedAt: new Date('2026-01-01'),
    },
    {
      orgId: chocoOrg.id,
      period: 'Q1-2026',
      revenueKzt: 84.2,
      marginPct: 34.2,
      clientsCount: 48,
      expensesKzt: 55.4,
      revenueChange: 12.4,
      marginChange: 2.1,
      clientsChange: 6,
      expensesChange: 8.2,
      recordedAt: new Date('2026-04-01'),
    },
  ]

  for (const snap of chocoSnaps) {
    await prisma.financialSnapshot.upsert({
      where: { id: `snap-${snap.orgId}-${snap.period}` },
      update: snap,
      create: { id: `snap-${snap.orgId}-${snap.period}`, ...snap },
    })
  }

  console.log('Seed completed successfully')
  console.log('Client user created: portal@chocofamily.kz / ChocoFamily2026!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
