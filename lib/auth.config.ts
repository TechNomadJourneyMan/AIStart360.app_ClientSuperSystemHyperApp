import GoogleProvider from 'next-auth/providers/google'
import type { NextAuthConfig } from 'next-auth'

export const authConfig: NextAuthConfig = {
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 часа
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.orgId = (user as any).orgId
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!
        ;(session.user as any).role = token.role
        ;(session.user as any).orgId = token.orgId
      }
      return session
    },
  },
}
