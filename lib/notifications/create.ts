import { createClient } from '@supabase/supabase-js'

// Single producer for in-app notifications. Best-effort: never throws. Inserts
// via the service role into app_notifications (no INSERT policy for authenticated
// users — the feed is self-read + self-mark-read only).

export type NotifCategory =
  | 'system' | 'security' | 'profile' | 'settings' | 'team' | 'integration' | 'report' | 'billing' | 'crm'
export type NotifPriority = 'critical' | 'high' | 'medium' | 'low'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function createNotification(input: {
  userId: string
  title: string
  body?: string
  category?: NotifCategory
  priority?: NotifPriority
  link?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await serviceClient().from('app_notifications').insert({
      user_id: input.userId,
      title: input.title,
      body: input.body ?? null,
      category: input.category ?? 'system',
      priority: input.priority ?? 'medium',
      link: input.link ?? null,
      metadata: input.metadata ?? {},
    })
  } catch (err) {
    console.error('[createNotification]', err)
  }
}
