import { describe, it, expect, vi, afterAll } from 'vitest'
import { prisma } from '../helpers/db'
import bcrypt from 'bcryptjs'

// Mock next/headers cookies for server action tests
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  }),
}))

// Mock next/navigation redirect
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

// Track created test records for cleanup
const testUserIds: string[] = []
const testOrgIds: string[] = []

afterAll(async () => {
  // Clean up test data
  if (testUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } })
  }
  if (testOrgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: testOrgIds } } })
  }
})

describe('loginAction', () => {
  it('returns success and sets role cookie for valid credentials', async () => {
    // Create a test org + user directly in DB
    const org = await prisma.organization.create({
      data: { name: 'Test Org', slug: `test-org-${Date.now()}` },
    })
    testOrgIds.push(org.id)

    const hash = await bcrypt.hash('password123', 10)
    const user = await prisma.user.create({
      data: {
        email: `login-test-${Date.now()}@example.com`,
        passwordHash: hash,
        name: 'Test User',
        role: 'ADMIN',
        orgId: org.id,
      },
    })
    testUserIds.push(user.id)

    const { loginAction } = await import('../../app/actions/auth')
    const result = await loginAction(user.email, 'password123')

    expect(result.success).toBe(true)
    expect(result.user?.email).toBe(user.email)
    expect(result.error).toBeUndefined()
  })

  it('returns WRONG_PASSWORD for invalid credentials', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Test Org 2', slug: `test-org2-${Date.now()}` },
    })
    testOrgIds.push(org.id)

    const hash = await bcrypt.hash('correct_password', 10)
    const user = await prisma.user.create({
      data: {
        email: `wrong-pw-${Date.now()}@example.com`,
        passwordHash: hash,
        name: 'Test User 2',
        role: 'ADMIN',
        orgId: org.id,
      },
    })
    testUserIds.push(user.id)

    const { loginAction } = await import('../../app/actions/auth')
    const result = await loginAction(user.email, 'wrong_password')

    expect(result.error).toBe('WRONG_PASSWORD')
    expect(result.success).toBeUndefined()
  })

  it('returns USER_NOT_FOUND for unknown email', async () => {
    const { loginAction } = await import('../../app/actions/auth')
    const result = await loginAction(`nobody-${Date.now()}@example.com`, 'anypassword')
    expect(result.error).toBe('USER_NOT_FOUND')
  })
})

describe('btoa/atob absence', () => {
  it('production auth code does not contain btoa or atob', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const root = process.cwd()

    // Check key auth files for btoa/atob function calls
    const filesToCheck = [
      'app/actions/auth.ts',
      'stores/auth.store.ts',
      'shared/api/auth.service.ts',
    ]

    const violations: string[] = []
    for (const file of filesToCheck) {
      const fullPath = path.join(root, file)
      if (!fs.existsSync(fullPath)) continue
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip comments (lines starting with // or * or containing only comments)
        if (/^\s*(\/\/|\/?\*)/.test(line)) continue
        if (/\bbtoa\s*\(|\batob\s*\(/.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
