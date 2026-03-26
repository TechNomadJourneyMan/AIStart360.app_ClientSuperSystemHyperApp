import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { prisma } from './db'
import type { UserRole } from '@prisma/client'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 часа
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        })

        if (!user || !user.passwordHash) return null

        const passwordValid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash
        )

        if (!passwordValid) return null

        // Update lastLogin
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          image: user.avatarUrl,
        }
      },
    }),

    // Google OAuth (опционально)
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // При первом логине добавляем role и orgId в token
      if (user) {
        token.role = (user as any).role as UserRole
        token.orgId = (user as any).orgId as string
      }
      return token
    },

    async session({ session, token }) {
      // Передаём role и orgId в session.user
      if (session.user) {
        session.user.id = token.sub!
        ;(session.user as any).role = token.role
        ;(session.user as any).orgId = token.orgId
      }
      return session
    },
  },
})
