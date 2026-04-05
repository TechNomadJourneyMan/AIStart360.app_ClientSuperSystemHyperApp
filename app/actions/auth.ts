'use server'

import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { randomBytes } from 'crypto'
import { Resend } from 'resend'
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

// ─── Zod Schemas ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
})

const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Пароль минимум 6 символов'),
  name: z.string().min(1, 'Имя обязательно'),
  role: z.enum(['admin', 'expert', 'owner', 'client']).optional().default('expert'),
  organization: z.string().optional(),
  position: z.string().optional(),
})

const resetPasswordRequestSchema = z.object({
  email: z.string().email('Некорректный email'),
})

const resetPasswordSchema = z.object({
  email: z.string().email('Некорректный email'),
  token: z.string().min(1, 'Токен обязателен'),
  newPassword: z.string().min(8, 'Пароль минимум 8 символов'),
  confirmPassword: z.string().min(8, 'Подтверждение пароля обязательно'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Пароли не совпадают',
})

// ─── Cookie options ─────────────────────────────────────────────────────────────

const COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
  httpOnly: true,
  sameSite: 'lax' as const,
}

// ─── Actions ────────────────────────────────────────────────────────────────────

/**
 * Register a new user and create an organization.
 */
export async function registerAction(data: unknown) {
  try {
    const parsed = registerSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }
    }
    const { email, password, name, role, organization, position } = parsed.data

    // 1. Check if user exists
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return { error: 'EMAIL_TAKEN' }

    // 2. Hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // 3. Create or find Organization
    const orgName = organization || `${name}'s Organization`
    const orgSlug = orgName.toLowerCase().trim().replace(/\s+/g, '-') + '-' + Date.now().toString(36)

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
      }
    })

    // 4. Map UI role to Prisma UserRole
    const prismaRole = role === 'admin' ? 'ADMIN' : role === 'owner' ? 'SUPER_ADMIN' : role === 'client' ? 'CLIENT' : 'MANAGER'

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: prismaRole,
        orgId: org.id,
      }
    })

    // 5. Set session cookies for middleware (httpOnly)
    const cookieStore = await cookies()
    cookieStore.set('aistart360_role', role!, COOKIE_OPTIONS)
    cookieStore.set('aistart360_user_id', user.id, COOKIE_OPTIONS)

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: role,
        organization: orgName
      }
    }
  } catch (error) {
    console.error('Registration error:', error)
    return { error: 'UNKNOWN' }
  }
}

/**
 * Authenticate user with password verification.
 */
export async function loginAction(email: string, password: string) {
  try {
    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { org: true }
    })

    if (!user || !user.passwordHash) return { error: 'USER_NOT_FOUND' }

    // Verify hash
    const isValid = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!isValid) return { error: 'WRONG_PASSWORD' }

    // Map Prisma role back to UI role
    const uiRole = user.role === 'SUPER_ADMIN' ? 'owner'
      : user.role === 'ADMIN' ? 'admin'
      : user.role === 'CLIENT' ? 'client'
      : 'expert'

    // Update cookies (httpOnly)
    const cookieStore = await cookies()
    cookieStore.set('aistart360_role', uiRole, COOKIE_OPTIONS)
    cookieStore.set('aistart360_user_id', user.id, COOKIE_OPTIONS)

    // Update lastLogin
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    })

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: uiRole,
        organization: user.org?.name || ''
      }
    }
  } catch (error) {
    console.error('Login error:', error)
    return { error: 'UNKNOWN' }
  }
}

/**
 * Log out — delete session cookies and redirect to /login.
 */
export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.set('aistart360_role', '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' })
  cookieStore.set('aistart360_user_id', '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' })
  redirect('/login')
}

/**
 * Request password reset link.
 * Returns neutral success to avoid email enumeration.
 */
export async function resetPasswordRequestAction(emailInput: string, db: DbClient = prisma) {
  try {
    const parsed = resetPasswordRequestSchema.safeParse({ email: emailInput })
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }
    }

    const email = parsed.data.email
    const user = await db.user.findUnique({ where: { email } })

    if (!user) {
      return { success: true }
    }

    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000)

    await db.verificationToken.deleteMany({ where: { identifier: email } })
    await db.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    })

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const appUrl = process.env.AUTH_URL || 'http://localhost:3000'
      const resetUrl = `${appUrl.replace(/\/$/, '')}/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`

      await resend.emails.send({
        from: 'AIStart360 <noreply@aistart360.app>',
        to: email,
        subject: 'Восстановление пароля AIStart360',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
            <h2>Восстановление пароля</h2>
            <p>Мы получили запрос на смену пароля для вашего аккаунта AIStart360.</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">
                Сбросить пароль
              </a>
            </p>
            <p>Ссылка действует 60 минут.</p>
          </div>
        `,
      })
    }

    return { success: true }
  } catch (error) {
    console.error('Reset password request error:', error)
    return { error: 'UNKNOWN' }
  }
}

/**
 * Reset password using one-time token.
 */
export async function resetPasswordAction(input: {
  email: string
  token: string
  newPassword: string
  confirmPassword: string
}, db: DbClient = prisma) {
  try {
    const parsed = resetPasswordSchema.safeParse(input)
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }
    }

    const { email, token, newPassword } = parsed.data

    const resetToken = await db.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    })

    if (!resetToken) {
      return { error: 'TOKEN_INVALID' }
    }

    if (resetToken.expires < new Date()) {
      await db.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: email,
            token,
          },
        },
      })
      return { error: 'TOKEN_EXPIRED' }
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      return { error: 'USER_NOT_FOUND' }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    await db.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Reset password error:', error)
    return { error: 'UNKNOWN' }
  }
}
