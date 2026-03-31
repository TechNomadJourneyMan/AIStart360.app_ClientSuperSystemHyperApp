import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch {
    return NextResponse.json({ status: 'error', db: 'disconnected' }, { status: 503 })
  }
}
