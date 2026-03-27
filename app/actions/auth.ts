'use server'

import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

/**
 * Register a new user and create an organization.
 */
export async function registerAction(data: any) {
  try {
    const { email, password, name, role, organization, position } = data
    
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
    // admin -> ADMIN, expert -> MANAGER, owner -> ADMIN
    const prismaRole = role === 'admin' ? 'ADMIN' : role === 'owner' ? 'SUPER_ADMIN' : 'MANAGER'
    
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: prismaRole,
        orgId: org.id,
      }
    })
    
    // 5. Set session cookies for middleware
    const cookieStore = cookies()
    cookieStore.set('aistart360_role', role, { path: '/', maxAge: 60 * 60 * 24 * 7 })
    cookieStore.set('aistart360_user_id', user.id, { path: '/', maxAge: 60 * 60 * 24 * 7 })
    
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
    const user = await prisma.user.findUnique({
      where: { email },
      include: { org: true }
    })
    
    if (!user || !user.passwordHash) return { error: 'USER_NOT_FOUND' }
    
    // Verify hash
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) return { error: 'WRONG_PASSWORD' }
    
    // Map Prisma role back to UI role
    const uiRole = user.role === 'SUPER_ADMIN' ? 'owner' : user.role === 'ADMIN' ? 'admin' : 'expert'
    
    // Update cookies
    const cookieStore = cookies()
    cookieStore.set('aistart360_role', uiRole, { path: '/', maxAge: 60 * 60 * 24 * 7 })
    cookieStore.set('aistart360_user_id', user.id, { path: '/', maxAge: 60 * 60 * 24 * 7 })
    
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
