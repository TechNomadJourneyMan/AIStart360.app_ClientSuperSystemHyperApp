import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        // @ts-ignore
        session.user.id = user.id
        // @ts-ignore
        session.user.role = (user as any).role
      }
      return session
    },
  },
  events: {
    async createUser({ user }) {
      // Create a default organization for the new user if they don't have one
      if (user.id) {
        const orgName = `${user.name || 'User'}'s Organization`
        const orgSlug = orgName.toLowerCase().trim().replace(/\s+/g, '-') + '-' + Date.now().toString(36)
        
        try {
          const org = await prisma.organization.create({
            data: {
              name: orgName,
              slug: orgSlug,
            }
          })
          
          await prisma.user.update({
            where: { id: user.id },
            data: { 
              orgId: org.id,
              role: 'ADMIN' // Default role for own organization
            }
          })
        } catch (error) {
          console.error('Error creating organization for new user:', error)
        }
      }
    }
  },
  pages: {
    signIn: '/login',
    error: '/login',
  }
})
