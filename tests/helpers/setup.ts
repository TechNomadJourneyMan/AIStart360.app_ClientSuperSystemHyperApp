import { config } from 'dotenv'
import { resolve } from 'path'
import { afterAll } from 'vitest'

// Load .env file for test environment
config({ path: resolve(__dirname, '../../.env') })

import { prisma } from './db'

afterAll(async () => {
  await prisma.$disconnect()
})
