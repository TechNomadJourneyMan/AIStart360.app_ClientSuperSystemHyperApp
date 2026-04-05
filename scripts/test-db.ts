import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const userCount = await prisma.user.count()
    console.log('User count:', userCount)
    const orgCount = await prisma.organization.count()
    console.log('Organization count:', orgCount)
    const snapCount = await prisma.financialSnapshot.count()
    console.log('FinancialSnapshot count:', snapCount)
  } catch (error) {
    console.error('Prisma connection error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
