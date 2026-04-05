import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

/**
 * Marker thrown inside $transaction to force a rollback.
 * Caught by withRollback — all other errors are re-thrown.
 */
export class RollbackMarker extends Error {
  constructor() {
    super('__rollback__')
    this.name = 'RollbackMarker'
  }
}

/**
 * Wraps a test body in a Prisma transaction that always rolls back.
 * Use instead of afterEach cleanup — atomically undoes all DB writes.
 *
 * Usage:
 *   it('creates a user', () => withRollback(async (tx) => {
 *     const user = await tx.user.create({ data: { ... } })
 *     expect(user.email).toBe('test@example.com')
 *   }))
 */
export async function withRollback<T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await fn(tx)
    throw new RollbackMarker()
  }).catch((err) => {
    if (err instanceof RollbackMarker) return
    throw err
  })
}
