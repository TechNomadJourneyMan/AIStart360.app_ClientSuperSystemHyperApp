import { NextRequest, NextResponse } from 'next/server'
import { notifyAdmins, type NotificationType } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

const VALID_TYPES: NotificationType[] = ['file_uploaded', 'user_registered', 'survey_completed']

/**
 * POST /api/notifications/send
 * Body: { type: 'file_uploaded' | 'user_registered' | 'survey_completed', userId?: string, data: Record<string, unknown> }
 *
 * Sends notification to admins via configured channels (email, Telegram).
 * Returns immediately — notification delivery is fire-and-forget.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, userId, data } = body

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { ok: false, error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'data field is required and must be an object' },
        { status: 400 },
      )
    }

    // Fire-and-forget — don't block the response
    notifyAdmins(type, data, userId)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
