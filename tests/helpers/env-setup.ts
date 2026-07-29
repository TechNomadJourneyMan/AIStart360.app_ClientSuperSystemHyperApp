import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env for the test process (does not override already-set vars).
config({ path: resolve(__dirname, '../../.env') })

// DB integration tests run only against an explicitly provided disposable
// database. Re-point DATABASE_URL BEFORE any PrismaClient is constructed so
// both tests/helpers/db.ts and app code under test hit the test DB, never
// the production one from .env. The gate lives in tests/helpers/db-env.ts.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
