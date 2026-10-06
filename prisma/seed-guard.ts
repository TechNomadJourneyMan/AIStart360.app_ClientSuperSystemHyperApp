/**
 * Guard for prisma/seed.ts (security P2-19).
 *
 * The seed starts with deleteMany() on users, organizations, clients, GRI
 * reports and pulse metrics, and `prisma migrate reset` / `prisma db seed` run
 * it automatically against whatever DATABASE_URL dotenv loaded — .env points
 * at the production Supabase. It therefore runs only when ALL of these hold:
 *   - ALLOW_DESTRUCTIVE_SEED=1 (explicit opt-in);
 *   - NODE_ENV is not 'production';
 *   - the DATABASE_URL host is local (localhost / 127.0.0.1 / ::1), the host
 *     of TEST_DATABASE_URL, or listed in SEED_ALLOWED_HOSTS (comma-separated).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** null when seeding may proceed, else the reason it may not. */
export function seedRefusal(env: Record<string, string | undefined>): string | null {
  if (env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    return 'ALLOW_DESTRUCTIVE_SEED=1 is not set — the seed deletes users, organizations and clients'
  }
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production'
  const host = hostOf(env.DATABASE_URL)
  if (!host) return 'DATABASE_URL is missing or not a URL'
  const allowed = new Set(LOCAL_HOSTS)
  const testHost = hostOf(env.TEST_DATABASE_URL)
  if (testHost) allowed.add(testHost)
  for (const h of (env.SEED_ALLOWED_HOSTS ?? '').split(',')) {
    if (h.trim()) allowed.add(h.trim().toLowerCase())
  }
  if (!allowed.has(host)) return `DATABASE_URL host "${host}" is not a local/test database`
  return null
}
