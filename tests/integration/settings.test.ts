import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { withRollback } from '../helpers/db'

const cookiesMock = vi.fn()

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}))

describe('settings data', () => {
  it('reads real email for current user from database', async () => {
    await withRollback(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Settings Test Org',
          slug: `settings-test-${Date.now().toString(36)}`,
        },
      })

      const passwordHash = await bcrypt.hash('password123', 10)
      const user = await tx.user.create({
        data: {
          email: `settings-${Date.now()}@example.com`,
          passwordHash,
          name: 'Settings User',
          role: 'ADMIN',
          orgId: org.id,
        },
      })

      cookiesMock.mockResolvedValue({
        get: (name: string) => {
          if (name === 'aistart360_user_id') {
            return { value: user.id }
          }
          return undefined
        },
      })

      const { getSettingsUserData } = await import('../../lib/settings-data')
      const result = await getSettingsUserData(tx)

      expect(result).not.toBeNull()
      expect(result?.email).toBe(user.email)
      expect(result?.name).toBe('Settings User')
      expect(result?.organizationName).toBe('Settings Test Org')
    })
  })
})
