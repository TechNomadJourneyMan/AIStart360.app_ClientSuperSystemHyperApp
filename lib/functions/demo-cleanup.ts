import { inngest } from '@/lib/inngest'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * Daily removal of demo accounts older than 24 h (created by
 * POST /api/auth/demo-access). Only accounts with the server-side marker
 * app_metadata.demo = true AND the generated demo-…@aistart360.app address are
 * touched. Their profile and data cascade with the auth user.
 */
const MAX_AGE_HOURS = 24
const DEMO_EMAIL = /^demo-[a-z0-9]+@aistart360\.app$/

export async function cleanupDemoAccounts(now = new Date()): Promise<{ scanned: number; deleted: number; failed: number }> {
  const admin = createServiceClient().auth.admin
  const cutoff = now.getTime() - MAX_AGE_HOURS * 3600_000
  let page = 1
  let scanned = 0
  let deleted = 0
  let failed = 0
  for (;;) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const users = data?.users ?? []
    scanned += users.length
    for (const u of users) {
      const isDemo = u.app_metadata?.demo === true && DEMO_EMAIL.test(u.email ?? '')
      if (!isDemo || new Date(u.created_at).getTime() > cutoff) continue
      const { error: delErr } = await admin.deleteUser(u.id)
      if (delErr) failed += 1
      else deleted += 1
    }
    if (users.length < 1000) break
    page += 1
  }
  return { scanned, deleted, failed }
}

export const demoAccountsCleanup = inngest.createFunction(
  {
    id: 'demo-accounts-cleanup',
    retries: 1,
    triggers: [{ cron: 'TZ=Asia/Almaty 30 4 * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => cleanupDemoAccounts(),
)
