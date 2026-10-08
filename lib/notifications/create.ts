import { createClient } from '@supabase/supabase-js'

// Single producer for in-app notifications. Best-effort: never throws. Inserts
// via the service role into app_notifications (no INSERT policy for authenticated
// users — the feed is self-read + self-mark-read only).
// Клиентские уведомления с учётом настроек шлёт lib/notifications/notify.ts
// (notifyClient) — он вызывает эту функцию для канала «в кабинете».

export type NotifCategory =
  | 'system' | 'security' | 'profile' | 'settings' | 'team' | 'integration' | 'report' | 'billing' | 'crm' | 'gri'
  | 'expert' | 'reminders' | 'digest'
export type NotifPriority = 'critical' | 'high' | 'medium' | 'low'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** true — запись создана; false — ошибка (залогирована). Никогда не бросает. */
export async function createNotification(input: {
  userId: string
  title: string
  body?: string
  category?: NotifCategory
  priority?: NotifPriority
  link?: string
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const { error } = await serviceClient().from('app_notifications').insert({
      user_id: input.userId,
      title: input.title,
      body: input.body ?? null,
      category: input.category ?? 'system',
      priority: input.priority ?? 'medium',
      link: input.link ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) {
      console.error('[createNotification]', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[createNotification]', err)
    return false
  }
}
