import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  name:     z.string().min(2),
  orgCode:  z.string().optional(), // invite code
})

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { email, password, name } = parsed.data

  // Проверить существующий email
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  // Найти или создать дефолтную организацию
  let org = await prisma.organization.findFirst({ where: { slug: 'default' } })
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Default Org', slug: 'default' }
    })
  }

  const user = await prisma.user.create({
    data: { email, passwordHash, name, orgId: org.id }
  })

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 }
  )
}
