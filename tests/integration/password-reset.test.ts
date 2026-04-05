import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { withRollback } from '../helpers/db'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: sendMock,
    }
  },
}))

describe('password reset actions', () => {
  it('resetPasswordRequestAction creates verification token', async () => {
    await withRollback(async (tx) => {
      process.env.RESEND_API_KEY = 'test_key'

      const org = await tx.organization.create({
        data: {
          name: 'Reset Org',
          slug: `reset-org-${Date.now().toString(36)}`,
        },
      })

      const email = `reset-${Date.now()}@example.com`
      const passwordHash = await bcrypt.hash('old-password', 10)

      await tx.user.create({
        data: {
          email,
          passwordHash,
          name: 'Reset User',
          role: 'ADMIN',
          orgId: org.id,
        },
      })

      const { resetPasswordRequestAction } = await import('../../app/actions/auth')
      const result = await resetPasswordRequestAction(email, tx)

      expect(result.success).toBe(true)
      const token = await tx.verificationToken.findFirst({ where: { identifier: email } })
      expect(token).not.toBeNull()
    })
  })

  it('returns TOKEN_EXPIRED for expired reset token', async () => {
    await withRollback(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Expired Org',
          slug: `expired-org-${Date.now().toString(36)}`,
        },
      })

      const email = `expired-${Date.now()}@example.com`
      const passwordHash = await bcrypt.hash('old-password', 10)

      await tx.user.create({
        data: {
          email,
          passwordHash,
          name: 'Expired User',
          role: 'ADMIN',
          orgId: org.id,
        },
      })

      await tx.verificationToken.create({
        data: {
          identifier: email,
          token: 'expired-token',
          expires: new Date(0),
        },
      })

      const { resetPasswordAction } = await import('../../app/actions/auth')
      const result = await resetPasswordAction({
        email,
        token: 'expired-token',
        newPassword: 'new-password-123',
        confirmPassword: 'new-password-123',
      }, tx)

      expect(result.error).toBe('TOKEN_EXPIRED')
    })
  })

  it('updates password hash for valid reset token', async () => {
    await withRollback(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Valid Org',
          slug: `valid-org-${Date.now().toString(36)}`,
        },
      })

      const email = `valid-${Date.now()}@example.com`
      const oldHash = await bcrypt.hash('old-password', 10)

      const user = await tx.user.create({
        data: {
          email,
          passwordHash: oldHash,
          name: 'Valid User',
          role: 'ADMIN',
          orgId: org.id,
        },
      })

      await tx.verificationToken.create({
        data: {
          identifier: email,
          token: 'valid-token',
          expires: new Date(Date.now() + 60_000),
        },
      })

      const { resetPasswordAction } = await import('../../app/actions/auth')
      const result = await resetPasswordAction({
        email,
        token: 'valid-token',
        newPassword: 'new-password-123',
        confirmPassword: 'new-password-123',
      }, tx)

      expect(result.success).toBe(true)

      const updated = await tx.user.findUnique({ where: { id: user.id } })
      expect(updated?.passwordHash).toBeTruthy()
      expect(updated?.passwordHash).not.toBe(oldHash)

      const compareOk = await bcrypt.compare('new-password-123', updated!.passwordHash!)
      expect(compareOk).toBe(true)

      const tokenAfter = await tx.verificationToken.findUnique({
        where: { identifier_token: { identifier: email, token: 'valid-token' } },
      })
      expect(tokenAfter).toBeNull()
    })
  })
})
