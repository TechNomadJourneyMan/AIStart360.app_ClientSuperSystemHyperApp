import { describe, expect, it } from 'vitest'
import { resolveSupabaseTestEnv } from '../../helpers/supabase-test-env'

const PROD = 'https://prodref.supabase.co'

describe('resolveSupabaseTestEnv — integration suites never write to the app project', () => {
  it('is off without an explicit test project, even when the app keys are in the env', () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: PROD, SUPABASE_SERVICE_ROLE_KEY: 'prod-key' }
    expect(resolveSupabaseTestEnv(env, [PROD])).toBeNull()
  })

  it('is off when only one of the two test variables is set', () => {
    expect(resolveSupabaseTestEnv({ TEST_SUPABASE_URL: 'https://testref.supabase.co' }, [PROD])).toBeNull()
    expect(resolveSupabaseTestEnv({ TEST_SUPABASE_SERVICE_ROLE_KEY: 'k' }, [PROD])).toBeNull()
  })

  it('returns the disposable project when it is not the app one', () => {
    const env = { TEST_SUPABASE_URL: 'https://testref.supabase.co', TEST_SUPABASE_SERVICE_ROLE_KEY: 'test-key' }
    expect(resolveSupabaseTestEnv(env, [PROD, undefined])).toEqual({ url: 'https://testref.supabase.co', serviceRoleKey: 'test-key' })
  })

  it('refuses the app project, whatever the spelling of its URL', () => {
    for (const url of [PROD, `${PROD}/`, 'HTTPS://PRODREF.supabase.co', ` ${PROD} `]) {
      expect(() => resolveSupabaseTestEnv({ TEST_SUPABASE_URL: url, TEST_SUPABASE_SERVICE_ROLE_KEY: 'k' }, [PROD])).toThrow(/app's own Supabase project/)
    }
  })
})
