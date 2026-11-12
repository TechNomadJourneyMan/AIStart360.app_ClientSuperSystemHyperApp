import { PrismaClient } from '@prisma/client'
import { localDevPrismaDatasourceUrl, persistentPrismaDatasourceUrl } from '@/lib/runtime/prisma-url'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  // A persistent server (Railway) shares one client across all requests: its pool size comes from
  // PRISMA_CONNECTION_LIMIT (lib/runtime/prisma-url.ts). Elsewhere this is undefined and the client
  // is built from DATABASE_URL exactly as before — except local `next dev` with PRISMA_DATASOURCE=direct.
  const datasourceUrl = persistentPrismaDatasourceUrl() ?? localDevPrismaDatasourceUrl()
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
