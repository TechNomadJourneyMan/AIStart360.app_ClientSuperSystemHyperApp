import { createClient } from '@supabase/supabase-js'

// Client-facing activity journal writer. Best-effort: never throws, so a logging
// failure can't break the action that triggered it. Inserts via the service role
// (the activity_log table has no INSERT policy for authenticated users — it is
// immutable + self-read-only from the app).

export type ActivityCategory =
  | 'system' | 'security' | 'profile' | 'settings' | 'team' | 'integration' | 'report' | 'billing'
export type ActivitySeverity = 'info' | 'warning' | 'critical'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function logActivity(input: {
  userId: string
  action: string
  category?: ActivityCategory
  description?: string
  severity?: ActivitySeverity
  status?: 'success' | 'failure'
  metadata?: Record<string, unknown>
  req?: Request
}): Promise<void> {
  try {
    const h = input.req?.headers
    const ip = h?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h?.get('x-real-ip') ?? null
    const ua = h?.get('user-agent') ?? null

    await serviceClient().from('activity_log').insert({
      user_id: input.userId,
      action: input.action,
      category: input.category ?? 'system',
      description: input.description ?? null,
      severity: input.severity ?? 'info',
      status: input.status ?? 'success',
      metadata: input.metadata ?? {},
      ip_address: ip,
      user_agent: ua,
    })
  } catch (err) {
    console.error('[logActivity]', err)
  }
}
