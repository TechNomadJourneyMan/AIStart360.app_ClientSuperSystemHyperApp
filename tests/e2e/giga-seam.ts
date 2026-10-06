/**
 * GIGA panel access for Playwright without Supabase and without the removed
 * shared-password entry: seed an approved super_admin in the E2E database and
 * hand the browser the test-only seam cookie (lib/admin/e2e-auth-seam-edge.ts).
 *
 * The dev server must run with the SAME E2E_AUTH_SEAM_SECRET (≥32 chars) and
 * NODE_ENV !== 'production' (`next dev`); a production build ignores the seam.
 */
import { randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import pg from 'pg'
import { E2E_SEAM_COOKIE_NAME, signE2eSeamCookie } from '@/lib/admin/e2e-auth-seam-edge'

export interface SeamStaff {
  userId: string
  /** Give the browser the seam cookie for this staff member. */
  login(context: BrowserContext, baseURL: string): Promise<void>
  /** Remove the seeded account (profile and staff role cascade). */
  cleanup(): Promise<void>
}

export async function seedSeamSuperAdmin(databaseUrl: string): Promise<SeamStaff> {
  const userId = randomUUID()
  const db = new pg.Client({ connectionString: databaseUrl })
  await db.connect()
  try {
    // The signup trigger creates a pending client profile; promote it the way
    // migration 099 promotes the owner account.
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, `e2e-super-admin-${userId}@e2e.local`])
    await db.query(`UPDATE public.profiles SET role = 'super_admin', status = 'approved', approved_at = now() WHERE id = $1`, [userId])
    await db.query(
      `INSERT INTO public.staff_roles (user_id, role, granted_by) VALUES ($1, 'super_admin', 'e2e')
       ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin'`,
      [userId],
    )
  } finally {
    await db.end()
  }

  return {
    userId,
    async login(context, baseURL) {
      await context.addCookies([{ name: E2E_SEAM_COOKIE_NAME, value: await signE2eSeamCookie(userId), url: baseURL }])
    },
    async cleanup() {
      const c = new pg.Client({ connectionString: databaseUrl })
      await c.connect()
      try {
        await c.query(`DELETE FROM auth.users WHERE id = $1`, [userId])
      } finally {
        await c.end()
      }
    },
  }
}
