import { afterAll } from 'vitest'
import { prisma } from './db'

afterAll(async () => {
  await prisma.$disconnect()
})
