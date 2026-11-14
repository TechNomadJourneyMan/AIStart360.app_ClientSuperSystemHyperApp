import { rememberAppSupabaseUrls, sanitizeTestEnv } from './test-env-guard'

// R-010: the test process never loads .env / .env.local any more — they hold
// real Resend / OpenRouter keys and the address of a cloud database with a
// full copy of production data. Whatever the shell or CI exported is scrubbed
// into a hermetic environment (see tests/helpers/test-env-guard.ts):
//   - secrets and external-service variables are removed,
//   - URLs to non-local hosts are removed,
//   - NEXT_PUBLIC_SUPABASE_URL & co. get dead local dummies,
//   - DATABASE_URL / DIRECT_URL point at TEST_DATABASE_URL (must be local,
//     otherwise this throws) or at a dead local stub.
//
// This file must run first (vitest.config.ts setupFiles): it fixes the env
// before any PrismaClient / Supabase client is constructed. The network guard
// that backs it up lives in tests/helpers/setup.ts.
const { appSupabaseUrls } = sanitizeTestEnv(process.env)
rememberAppSupabaseUrls(appSupabaseUrls)
