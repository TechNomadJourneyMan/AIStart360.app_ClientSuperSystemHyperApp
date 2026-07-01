import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity/log'
import { createNotification } from '@/lib/notifications/create'

// Self-scoped profile read/write for the Settings › Профиль tab.
// Mirrors the proven write pattern in app/api/expert/profile but WITHOUT the
// role gate and always scoped to the caller's own row (never trusts an id from
// the body). Writes to the existing `profiles` columns — no new tables.
export const dynamic = 'force-dynamic'

const PATCH_SCHEMA = z.object({
  full_name: z.string().trim().min(1, 'Укажите имя').max(120).optional(),
  position: z.string().trim().max(120).optional(),
  organization: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
})

const SELECT = 'full_name, email, position, organization, phone, avatar_url'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select(SELECT)
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[settings/profile GET]', error)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: { ...data, email: data?.email ?? user.email ?? '' } })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = PATCH_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  // Patch only the fields the client actually sent.
  const update = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'no_fields' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', user.id) // self-scope
      .select(SELECT)
      .maybeSingle()

    if (error) {
      console.error('[settings/profile PATCH]', error)
      return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
    }
    await logActivity({
      userId: user.id,
      action: 'profile.updated',
      category: 'profile',
      description: 'Обновлён профиль',
      metadata: { fields: Object.keys(update) },
      req: request,
    })
    await createNotification({
      userId: user.id,
      title: 'Профиль обновлён',
      body: 'Изменения в вашем профиле сохранены.',
      category: 'profile',
      priority: 'low',
      link: '/settings',
    })
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('[settings/profile PATCH]', err)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
}
