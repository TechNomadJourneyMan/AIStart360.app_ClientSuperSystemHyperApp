import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/send — RETIRED (security P2-1).
 *
 * It accepted any NextAuth session (the mounted Google provider has no adapter
 * and no signIn callback, so any Google account got one) and forwarded
 * caller-supplied data to every admin by email and Telegram. Nothing in the
 * app calls it: admin notifications are sent server-side (lib/notifications.ts
 * notifyAdmins) by the flows that produce the events. The endpoint now refuses
 * every request and never sends anything; delete the file once no external
 * caller is confirmed.
 */
export async function POST() {
  return NextResponse.json({ ok: false, error: 'gone' }, { status: 410 })
}
