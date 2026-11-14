export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { endImpersonationInThisBrowser } from '@/lib/impersonation/exit'

// POST /api/v1/impersonation/exit — «Выйти из режима пользователя».
// Closes the DB session, signs the browser out of the user's account and sends
// the admin back to the user's card in GIGA-CRM.
//
// R-008: only the impersonation session is revoked (signOut scope 'local' —
// the GoTrue session of this browser), never every session of the client
// (the default 'global' threw the client out on all their devices). Without
// the cookie the session is found through its server-side binding
// (lib/impersonation/exit.ts — readImpersonation + the binding).
export async function POST(req: NextRequest) {
  const { found, targetUserId } = await endImpersonationInThisBrowser(req, 'exit')
  if (!found || !targetUserId) return NextResponse.json({ ok: true, redirect: '/admin-giga-panel' })
  return NextResponse.json({ ok: true, redirect: `/admin-giga-panel/users/${targetUserId}` })
}
