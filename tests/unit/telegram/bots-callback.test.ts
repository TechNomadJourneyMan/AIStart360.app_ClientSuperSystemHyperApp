/**
 * Signed compact callback_data of the bots (lib/telegram/bots/callback.ts):
 * ≤ 64 bytes, UUID packing, tamper rejection, bot binding, key rotation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CALLBACK_MAX_BYTES, packArg, signCallback, unpackArg, verifyCallback } from '@/lib/telegram/bots/callback'

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const saved: Record<string, string | undefined> = {}
const KEYS = ['TELEGRAM_CALLBACK_SECRET', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_SECRET']

describe('bot callback signing', () => {
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    for (const k of KEYS) delete process.env[k]
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'expert-secret'
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('round-trips actions and args, packing UUIDs to fit in 64 bytes', () => {
    const data = signCallback('admin', 'tk.c', UUID)!
    expect(data).toBeTruthy()
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES)
    expect(data).not.toContain(UUID)
    expect(verifyCallback('admin', data)).toEqual({ action: 'tk.c', args: [UUID] })
    expect(unpackArg(packArg(UUID))).toBe(UUID)

    const multi = signCallback('admin', 'ag.rc', 'Ab12_-', UUID)!
    expect(Buffer.byteLength(multi)).toBeLessThanOrEqual(64)
    expect(verifyCallback('admin', multi)).toEqual({ action: 'ag.rc', args: ['Ab12_-', UUID] })
  })

  it('rejects tampered action, args or signature', () => {
    const data = signCallback('admin', 'ag.on', 'abc123')!
    const [action, arg, sig] = data.split('|')
    expect(verifyCallback('admin', `ag.off|${arg}|${sig}`)).toBeNull()
    expect(verifyCallback('admin', `${action}|abc124|${sig}`)).toBeNull()
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    expect(verifyCallback('admin', `${action}|${arg}|${flipped}`)).toBeNull()
    expect(verifyCallback('admin', `${action}|${arg}`)).toBeNull()
    expect(verifyCallback('admin', 'garbage')).toBeNull()
    expect(verifyCallback('admin', undefined)).toBeNull()
    expect(verifyCallback('admin', `${data}${'x'.repeat(64)}`)).toBeNull()
  })

  it('binds a button to its bot: an admin button does not work in the expert bot', () => {
    process.env.TELEGRAM_CALLBACK_SECRET = 'shared-secret' // same key for both bots
    const data = signCallback('admin', 'cl.c', UUID)!
    expect(verifyCallback('admin', data)).not.toBeNull()
    expect(verifyCallback('expert', data)).toBeNull()
  })

  it('refuses to sign without a key or when the data would not fit', () => {
    delete process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET
    expect(signCallback('admin', 'st.r')).toBeNull()
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    expect(signCallback('admin', 'ag.run', UUID, UUID)).toBeNull() // 67 bytes > 64
    expect(signCallback('admin', 'BAD ACTION')).toBeNull()
    expect(signCallback('admin', 'ok', 'has|pipe')).toBeNull()
  })

  it('keeps accepting buttons signed with the webhook secret after TELEGRAM_CALLBACK_SECRET is added', () => {
    const old = signCallback('admin', 'st.r')!
    process.env.TELEGRAM_CALLBACK_SECRET = 'new-dedicated-secret'
    expect(verifyCallback('admin', old)).toEqual({ action: 'st.r', args: [] })
    const fresh = signCallback('admin', 'st.r')!
    expect(fresh).not.toBe(old)
    expect(verifyCallback('admin', fresh)).not.toBeNull()
  })
})
