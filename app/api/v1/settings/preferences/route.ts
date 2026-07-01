import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity/log'

// Self-scoped read/deep-merge of profiles.preferences (JSONB).
// Powers Settings › Внешний вид (appearance) and Уведомления (notifications).
// Body is a partial preferences object and is deep-merged into the existing bag.
export const dynamic = 'force-dynamic'

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k] as Json, v) : v
  }
  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[settings/preferences GET]', error)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: (data?.preferences as Json) ?? {} })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!isObject(body)) {
    return NextResponse.json({ ok: false, error: 'body_must_be_object' }, { status: 422 })
  }

  try {
    const { data: cur } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .maybeSingle()

    const merged = deepMerge((cur?.preferences as Json) ?? {}, body)

    const { error } = await supabase
      .from('profiles')
      .update({ preferences: merged })
      .eq('id', user.id)

    if (error) {
      console.error('[settings/preferences PATCH]', error)
      return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
    }
    await logActivity({
      userId: user.id,
      action: 'settings.updated',
      category: 'settings',
      description: 'Обновлены настройки',
      metadata: { sections: Object.keys(body) },
      req: request,
    })
    return NextResponse.json({ ok: true, data: merged })
  } catch (err) {
    console.error('[settings/preferences PATCH]', err)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
}
