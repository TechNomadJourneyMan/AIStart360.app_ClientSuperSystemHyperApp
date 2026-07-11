export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { adminResetUserMfa } from '@/lib/mfa/store'
import { createServiceClient } from '@/lib/supabase-service'
import { sendNotificationEmail } from '@/lib/email'

/**
 * POST /api/giga-admin/users/:id/2fa-reset
 *
 * Emergency MFA recovery. Clears the target user's TOTP secret, backup codes and
 * passkeys, plus the middleware gate flags, so a locked-out user (lost their
 * authenticator with no saved backup codes) can sign in with their password
 * again.
 *
 * Authorization is the super_admin giga cookie — NO user TOTP code is required,
 * because a locked-out user cannot produce one. The action is audited and the
 * user is emailed a security notification.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = params

  try {
    await adminResetUserMfa(id)

    await logAudit({
      entityType: 'user',
      entityId: id,
      action: 'user.2fa_reset',
      performedBy: actor.id,
      diff: { effect: 'mfa_cleared', totp: true, webauthn: true, backup_codes: 'wiped', actorKind: actor.kind },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    // Notify the user (best-effort — never block the reset on email delivery).
    try {
      const sb = createServiceClient()
      const { data: profile } = await sb
        .from('profiles')
        .select('email, full_name')
        .eq('id', id)
        .maybeSingle()

      if (profile?.email) {
        const base = process.env.AUTH_URL
        await sendNotificationEmail({
          to: profile.email as string,
          subject: 'Двухфакторная аутентификация сброшена',
          title: 'Двухфакторная аутентификация сброшена',
          body:
            `${profile.full_name ? profile.full_name + ', ' : ''}` +
            'двухфакторная аутентификация для вашего аккаунта была сброшена администратором — теперь вы можете войти по паролю. ' +
            'Если это были не вы, немедленно смените пароль и заново включите 2FA в настройках безопасности.',
          ...(base ? { ctaLabel: 'Войти', ctaUrl: `${base}/login` } : {}),
        })
      }
    } catch (e) {
      console.error('[giga-admin/2fa-reset] notify failed:', e)
    }

    return NextResponse.json({ ok: true, message: '2FA сброшена — пользователь может войти по паролю.' })
  } catch (error) {
    console.error('[giga-admin/2fa-reset] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
