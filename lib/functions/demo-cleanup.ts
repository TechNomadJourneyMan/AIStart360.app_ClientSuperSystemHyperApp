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
const PER_PAGE = 1000

/**
 * GoTrue lists users with offset pagination, so deleting while paging would
 * shift later users into pages already read and skip them. The expired demo
 * accounts are therefore collected across ALL pages first, then deleted.
 * Failed deletions are logged with the user id and the error.
 */
export async function cleanupDemoAccounts(now = new Date()): Promise<{ scanned: number; deleted: number; failed: number }> {
  const admin = createServiceClient().auth.admin
  const cutoff = now.getTime() - MAX_AGE_HOURS * 3600_000
  let page = 1
  let scanned = 0
  const expired: string[] = []
  for (;;) {
    const { data, error } = await admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const users = data?.users ?? []
    scanned += users.length
    for (const u of users) {
      const isDemo = u.app_metadata?.demo === true && DEMO_EMAIL.test(u.email ?? '')
      if (isDemo && new Date(u.created_at).getTime() <= cutoff) expired.push(u.id)
    }
    if (users.length < PER_PAGE) break
    page += 1
  }

  let deleted = 0
  let failed = 0
  for (const id of expired) {
    const { error: delErr } = await admin.deleteUser(id)
    if (delErr) {
      failed += 1
      console.error('[demo-cleanup] could not delete demo user', id, delErr.status ?? '', delErr.message)
    } else {
      deleted += 1
    }
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
