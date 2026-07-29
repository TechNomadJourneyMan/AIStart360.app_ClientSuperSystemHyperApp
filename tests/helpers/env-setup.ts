import { config } from 'dotenv'
import { resolve } from 'path'

// Keys the real shell/CI environment already carries. dotenv never overrides
// them, so anything that appears afterwards came from .env and is a local
// deployment setting rather than a deliberate test input.
const shellKeys = new Set(Object.keys(process.env))

// Load .env for the test process (does not override already-set vars).
const loaded = config({ path: resolve(__dirname, '../../.env') })

// Deployment switches for the messaging integrations must NOT leak from a
// developer's .env into the suite. They select fail-closed branches at runtime
// (direct Postgres ingestion, WhatsApp Web pull delivery, Meta verification),
// and the specs assert the unconfigured baseline, setting whatever they need
// themselves. CI has no .env, so a populated local one made ~20 unit tests fail
// only on the developer's machine. Vars exported in the shell are preserved.
const DEPLOYMENT_INTEGRATION_KEY = /^(OMNICHANNEL_|WHATSAPP_|META_|INSTAGRAM_|MYHONOR_)/
for (const key of Object.keys(loaded.parsed ?? {})) {
  if (shellKeys.has(key)) continue
  if (DEPLOYMENT_INTEGRATION_KEY.test(key)) delete process.env[key]
}

// DB integration tests run only against an explicitly provided disposable
// database. Re-point DATABASE_URL BEFORE any PrismaClient is constructed so
// both tests/helpers/db.ts and app code under test hit the test DB, never
// the production one from .env. The gate lives in tests/helpers/db-env.ts.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
