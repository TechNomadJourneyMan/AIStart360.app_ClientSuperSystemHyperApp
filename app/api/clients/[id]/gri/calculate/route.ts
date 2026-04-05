import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'

// POST /api/clients/:id/gri/calculate
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth()
  if (error) return error

  const { inngest } = await import('@/lib/inngest')

  // Запустить фоновый расчёт
  await inngest.send({
    name: 'gri/calculate',
    data: { clientId: params.id },
  })

  return NextResponse.json({ message: 'GRI calculation queued' })
}
