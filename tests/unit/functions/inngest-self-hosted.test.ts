/**
 * lib/inngest.ts — our own Inngest server on Railway (2026-11-15: the Inngest Cloud plan ran out and
 * the cloud stopped calling the portal). INNGEST_SELF_HOSTED_URL points the client at it with its own
 * keys and «not dev mode»; without it the client is the cloud one, as before. lib/functions/registry.ts
 * — INNGEST_DISABLED_FUNCTIONS holds back single functions (a job that deletes data until the PO allows it).
 */
import { describe, expect, it } from 'vitest'
import { __inngestClientOptions } from '@/lib/inngest'
import { inngestEnabled, inngestTarget } from '@/lib/inngest-target'
import { disabledFunctionIds, inngestFunctionsForRole } from '@/lib/functions/registry'

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv
const idsOf = (functions: readonly unknown[]) => functions.map((fn) => (fn as { opts: { id: string } }).opts.id)

describe('the Inngest client target', () => {
  it('without INNGEST_SELF_HOSTED_URL: the cloud client of before (keys from the cloud variables)', () => {
    expect(inngestTarget(env({ INNGEST_EVENT_KEY: 'cloud' }))).toEqual({ selfHostedUrl: null })
    expect(__inngestClientOptions(env({ INNGEST_EVENT_KEY: 'cloud', INNGEST_SIGNING_KEY: 'signkey-prod-ab' }))).toEqual({ id: 'aistart360' })
  })

  it('with it: our server, its own keys, never dev mode, and no trailing slash', () => {
    const vars = env({
      INNGEST_SELF_HOSTED_URL: ' http://inngest.railway.internal:8288/ ',
      INNGEST_SELF_EVENT_KEY: 'self-event',
      INNGEST_SELF_SIGNING_KEY: 'abcd1234',
      INNGEST_EVENT_KEY: 'cloud-event',
      INNGEST_SIGNING_KEY: 'signkey-prod-cloud',
    })
    expect(__inngestClientOptions(vars)).toEqual({
      id: 'aistart360',
      baseUrl: 'http://inngest.railway.internal:8288',
      isDev: false,
      eventKey: 'self-event',
      signingKey: 'abcd1234',
    })
  })

  it('an empty INNGEST_SELF_HOSTED_URL is «not set»', () => {
    expect(inngestTarget(env({ INNGEST_SELF_HOSTED_URL: '   ' })).selfHostedUrl).toBeNull()
  })

  it('events can be delivered with the self-hosted server alone, the cloud key or the dev server; otherwise callers work inline', () => {
    expect(inngestEnabled(env({ INNGEST_SELF_HOSTED_URL: 'http://inngest.railway.internal:8288' }))).toBe(true)
    expect(inngestEnabled(env({ INNGEST_EVENT_KEY: 'cloud' }))).toBe(true)
    expect(inngestEnabled(env({ INNGEST_DEV: '1' }))).toBe(true)
    expect(inngestEnabled(env({}))).toBe(false)
  })
})

describe('INNGEST_DISABLED_FUNCTIONS', () => {
  it('parses ids separated by commas or spaces and ignores blanks', () => {
    expect([...disabledFunctionIds(env({ INNGEST_DISABLED_FUNCTIONS: ' assistant-events-retention, demo-accounts-cleanup  x ' }))]).toEqual([
      'assistant-events-retention', 'demo-accounts-cleanup', 'x',
    ])
    expect(disabledFunctionIds(env({})).size).toBe(0)
  })

  it('a disabled function is not served (web and all); the rest keep their order; unknown ids change nothing', () => {
    const full = idsOf(inngestFunctionsForRole('web', env({})))
    const held = idsOf(inngestFunctionsForRole('web', env({ INNGEST_DISABLED_FUNCTIONS: 'assistant-events-retention,no-such-fn' })))
    expect(full).toContain('assistant-events-retention')
    expect(held).toEqual(full.filter((id) => id !== 'assistant-events-retention'))
    expect(idsOf(inngestFunctionsForRole('all', env({ INNGEST_DISABLED_FUNCTIONS: 'assistant-events-retention' })))).not.toContain('assistant-events-retention')
    expect(inngestFunctionsForRole('agents', env({ INNGEST_DISABLED_FUNCTIONS: '' }))).toEqual([])
  })
})
