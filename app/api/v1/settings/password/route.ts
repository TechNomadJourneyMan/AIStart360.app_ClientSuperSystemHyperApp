import { NextResponse } from 'next/server'
import { createClient as createStandalone } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'

// Change the caller's own password. Verifies the current password first (via a
// throwaway standalone client that does NOT touch session cookies), then updates
// on the session client. No new tables.
export const dynamic = 'force-dynamic'

const SCHEMA = z.object({
  current: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z.string().min(8, 'Минимум 8 символов').max(72),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = SCHEMA.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }
  const { current, newPassword } = parsed.data
  if (current === newPassword) {
    return NextResponse.json({ ok: false, error: 'same_password' }, { status: 422 })
  }

  // Verify current password without disturbing the live session.
  const verifier = createStandalone(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: signErr } = await verifier.auth.signInWithPassword({ email: user.email, password: current })
  if (signErr) {
    return NextResponse.json({ ok: false, error: 'wrong_current_password' }, { status: 422 })
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword })
  if (updErr) {
    console.error('[settings/password]', updErr.message)
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 422 })
  }
  await logActivity({
    userId: user.id,
    action: 'security.password_changed',
    category: 'security',
    severity: 'critical',
    description: 'Пароль изменён',
    req: request,
  })
  await createNotification({
    userId: user.id,
    title: 'Пароль изменён',
    body: 'Пароль вашего аккаунта был успешно изменён. Если это были не вы — немедленно смените пароль.',
    category: 'security',
    priority: 'high',
    link: '/settings',
  })
  return NextResponse.json({ ok: true })
}
