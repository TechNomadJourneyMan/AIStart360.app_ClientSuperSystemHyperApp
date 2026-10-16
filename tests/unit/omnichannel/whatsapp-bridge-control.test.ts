import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    throw new Error('no database in unit tests')
  },
}))

import { memoryStore } from './_bridge-control-store'
import {
  ackBridgeCommand,
  BRIDGE_STALE_AFTER_MS,
  bridgeStatusView,
  claimBridgeCommand,
  issueBridgeCommand,
  normalizePushedStatus,
  readBridgeControlSnapshot,
  recordBridgeStatus,
  resetBridgeStatusThrottle,
  type PushedBridgeStatus,
} from '@/lib/omnichannel/whatsapp-bridge-control'
import {
  getWhatsAppWebBridgeConfig,
  getWhatsAppWebBridgeConfigurationHealth,
  isConfiguredWhatsAppWebAccount,
  whatsappWebBridgeControlMode,
  type WhatsAppWebBridgeEnvironment,
} from '@/lib/omnichannel/whatsapp-web-client'

const T0 = new Date('2026-10-16T10:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

function push(overrides: Partial<PushedBridgeStatus> = {}): PushedBridgeStatus {
  return {
    sessionId: 'primary',
    state: 'connected',
    connected: true,
    qr: null,
    qrExpiresAt: null,
    errorCode: null,
    updatedAt: T0.toISOString(),
    bridgeVersion: '1.0.0',
    ...overrides,
  }
}

describe('bridge pull control — command lifecycle', () => {
  it('issue → claim → ack', async () => {
    const { store, commands } = memoryStore()
    const issued = await issueBridgeCommand(store, {
      sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:1', requestedBy: 'admin-1', now: T0,
    })
    expect(issued.kind).toBe('created')
    expect(issued.command.expires_at).toBe(at(120_000).toISOString())

    const claimed = await claimBridgeCommand(store, { sessionId: 'primary', now: at(1_000), leaseToken: '00000000-0000-4000-8000-0000000000aa' })
    expect(claimed).toMatchObject({ id: issued.command.id, action: 'connect', leaseToken: '00000000-0000-4000-8000-0000000000aa' })
    // Leased: a second claim gets nothing.
    expect(await claimBridgeCommand(store, { sessionId: 'primary', now: at(2_000) })).toBeNull()

    expect(await ackBridgeCommand(store, {
      sessionId: 'primary', commandId: claimed!.id, leaseToken: 'ffffffff-0000-4000-8000-000000000000', outcome: 'succeeded', now: at(3_000),
    })).toEqual({ accepted: false })
    expect(await ackBridgeCommand(store, {
      sessionId: 'primary', commandId: claimed!.id, leaseToken: claimed!.leaseToken, outcome: 'succeeded', now: at(3_000),
    })).toEqual({ accepted: true })
    expect(commands[0]).toMatchObject({ status: 'succeeded', attempts: 1, result_code: null })
    // Terminal: the ack cannot be replayed and nothing is claimable.
    expect((await ackBridgeCommand(store, {
      sessionId: 'primary', commandId: claimed!.id, leaseToken: claimed!.leaseToken, outcome: 'failed', now: at(4_000),
    })).accepted).toBe(false)
    expect(await claimBridgeCommand(store, { sessionId: 'primary', now: at(5_000) })).toBeNull()
  })

  it('records a failure code', async () => {
    const { store, commands } = memoryStore()
    await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:2', requestedBy: null, now: T0 })
    const claimed = await claimBridgeCommand(store, { sessionId: 'primary', now: T0 })
    await ackBridgeCommand(store, { sessionId: 'primary', commandId: claimed!.id, leaseToken: claimed!.leaseToken, outcome: 'failed', errorCode: 'connect_rate_limited', now: T0 })
    expect(commands[0]).toMatchObject({ status: 'failed', result_code: 'connect_rate_limited' })
  })

  it('keeps one command in flight: same action dedupes, a claimed other action is busy, a pending one is superseded', async () => {
    const { store, commands } = memoryStore()
    const first = await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:a', requestedBy: null, now: T0 })
    const again = await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:b', requestedBy: null, now: at(1_000) })
    expect(again).toMatchObject({ kind: 'existing', command: { id: first.command.id } })
    expect(commands).toHaveLength(1)

    // Not yet claimed → the newer intent wins.
    const logout = await issueBridgeCommand(store, { sessionId: 'primary', action: 'logout', idempotencyKey: 'omnichannel:bridge:logout:c', requestedBy: null, now: at(2_000) })
    expect(logout.kind).toBe('created')
    expect(commands.find((c) => c.id === first.command.id)).toMatchObject({ status: 'cancelled', result_code: 'superseded' })

    // Claimed → a different action must wait.
    await claimBridgeCommand(store, { sessionId: 'primary', now: at(3_000) })
    const busy = await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:d', requestedBy: null, now: at(4_000) })
    expect(busy).toMatchObject({ kind: 'busy', command: { action: 'logout', status: 'claimed' } })
    expect(commands.filter((c) => c.status === 'pending' || c.status === 'claimed')).toHaveLength(1)
  })

  it('expires commands after the TTL: no claim, and a new command can be issued', async () => {
    const { store, commands } = memoryStore()
    await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:e', requestedBy: null, now: T0 })
    expect(await claimBridgeCommand(store, { sessionId: 'primary', now: at(121_000) })).toBeNull()
    expect(commands[0].status).toBe('expired')

    const next = await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:f', requestedBy: null, now: at(122_000) })
    expect(next.kind).toBe('created')
  })

  it('issue expires a stale in-flight command instead of reporting it busy', async () => {
    const { store, commands } = memoryStore()
    await issueBridgeCommand(store, { sessionId: 'primary', action: 'logout', idempotencyKey: 'omnichannel:bridge:logout:g', requestedBy: null, now: T0 })
    await claimBridgeCommand(store, { sessionId: 'primary', now: T0 })
    const later = await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:h', requestedBy: null, now: at(130_000) })
    expect(later.kind).toBe('created')
    expect(commands[0].status).toBe('expired')
  })

  it('re-leases a claimed command whose lease lapsed (bridge crashed before ack); the old lease is fenced', async () => {
    const { store } = memoryStore()
    await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:i', requestedBy: null, now: T0 })
    const first = await claimBridgeCommand(store, { sessionId: 'primary', now: T0, leaseSeconds: 45 })
    expect(await claimBridgeCommand(store, { sessionId: 'primary', now: at(44_000) })).toBeNull()
    const second = await claimBridgeCommand(store, { sessionId: 'primary', now: at(46_000) })
    expect(second?.id).toBe(first?.id)
    expect(second?.leaseToken).not.toBe(first?.leaseToken)
    expect((await ackBridgeCommand(store, { sessionId: 'primary', commandId: first!.id, leaseToken: first!.leaseToken, outcome: 'succeeded' })).accepted).toBe(false)
    expect((await ackBridgeCommand(store, { sessionId: 'primary', commandId: second!.id, leaseToken: second!.leaseToken, outcome: 'succeeded' })).accepted).toBe(true)
  })

  it('never hands out a command of another session', async () => {
    const { store } = memoryStore()
    await issueBridgeCommand(store, { sessionId: 'other', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:j', requestedBy: null, now: T0 })
    expect(await claimBridgeCommand(store, { sessionId: 'primary', now: T0 })).toBeNull()
  })
})

describe('bridge pull control — status freshness and QR', () => {
  beforeEach(() => resetBridgeStatusThrottle())

  it('stores the QR only while pairing and caps its lifetime', () => {
    const pairing = normalizePushedStatus(push({
      state: 'qr', connected: false, qr: 'raw-qr', qrExpiresAt: at(60_000).toISOString(),
    }), T0)
    expect(pairing).toMatchObject({ state: 'qr', qr: 'raw-qr', qr_expires_at: at(60_000).toISOString(), connected: false })

    const capped = normalizePushedStatus(push({
      state: 'qr', connected: false, qr: 'raw-qr', qrExpiresAt: at(3_600_000).toISOString(),
    }), T0)
    expect(capped.qr_expires_at).toBe(at(120_000).toISOString())

    const connected = normalizePushedStatus(push({ state: 'connected', qr: 'leaked', qrExpiresAt: at(60_000).toISOString() }), T0)
    expect(connected).toMatchObject({ qr: null, qr_expires_at: null, connected: true })

    const expired = normalizePushedStatus(push({ state: 'qr', connected: false, qr: 'old', qrExpiresAt: at(-1).toISOString() }), T0)
    expect(expired.qr).toBeNull()
  })

  it('reports never seen, online, expired QR as connecting, and offline after 90 s', () => {
    expect(bridgeStatusView(null, T0)).toMatchObject({ state: 'never_seen', online: false, connected: false })

    const row = normalizePushedStatus(push({
      state: 'qr', connected: false, qr: 'raw-qr', qrExpiresAt: at(60_000).toISOString(),
    }), T0)
    expect(bridgeStatusView(row, at(30_000))).toMatchObject({ state: 'qr', qr: 'raw-qr', online: true })
    expect(bridgeStatusView(row, at(61_000))).toMatchObject({ state: 'connecting', qr: null, online: true })

    const live = normalizePushedStatus(push(), T0)
    expect(bridgeStatusView(live, at(BRIDGE_STALE_AFTER_MS))).toMatchObject({ state: 'connected', connected: true, online: true })
    expect(bridgeStatusView(live, at(BRIDGE_STALE_AFTER_MS + 1))).toMatchObject({
      state: 'offline', connected: false, online: false, lastSeenAt: T0.toISOString(),
    })
  })

  it('writes state changes at once but drops identical heartbeats closer than 15 s', async () => {
    const { store, calls } = memoryStore()
    expect(await recordBridgeStatus(store, push(), T0)).toEqual({ written: true })
    expect(await recordBridgeStatus(store, push(), at(5_000))).toEqual({ written: false })
    expect(await recordBridgeStatus(store, push(), at(15_000))).toEqual({ written: true })
    expect(await recordBridgeStatus(store, push({ state: 'error', connected: false, errorCode: 'connection_error', updatedAt: at(16_000).toISOString() }), at(16_000))).toEqual({ written: true })
    // A QR rotation is a change even within 15 s.
    await recordBridgeStatus(store, push({ state: 'qr', connected: false, qr: 'qr-1', qrExpiresAt: at(80_000).toISOString() }), at(20_000))
    expect(await recordBridgeStatus(store, push({ state: 'qr', connected: false, qr: 'qr-2', qrExpiresAt: at(80_000).toISOString() }), at(21_000))).toEqual({ written: true })
    expect(calls.upsertStatus).toBe(5)
  })

  it('snapshot clears an expired stored QR and reports the live in-flight command', async () => {
    const { store, statuses } = memoryStore()
    await recordBridgeStatus(store, push({ state: 'qr', connected: false, qr: 'raw-qr', qrExpiresAt: at(60_000).toISOString() }), T0)
    await issueBridgeCommand(store, { sessionId: 'primary', action: 'connect', idempotencyKey: 'omnichannel:bridge:connect:k', requestedBy: null, now: at(10_000) })

    const fresh = await readBridgeControlSnapshot(store, 'primary', at(20_000))
    expect(fresh.view.qr).toBe('raw-qr')
    expect(fresh.pendingCommand).toMatchObject({ action: 'connect', status: 'pending' })

    const later = await readBridgeControlSnapshot(store, 'primary', at(70_000))
    expect(later.view).toMatchObject({ state: 'connecting', qr: null })
    expect(statuses.get('primary')?.qr).toBeNull()

    const afterTtl = await readBridgeControlSnapshot(store, 'primary', at(140_000))
    expect(afterTtl.pendingCommand).toBeNull()
  })
})

describe('bridge configuration health — control modes', () => {
  const base: WhatsAppWebBridgeEnvironment = {
    NODE_ENV: 'production',
    WHATSAPP_WEB_BRIDGE_ENABLED: 'true',
    WHATSAPP_WEB_BRIDGE_SESSION_ID: 'primary',
    WHATSAPP_WEB_BRIDGE_API_SECRET: 'bridge-outbound-secret-0123456789abcdef',
    WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: 'portal-inbound-secret-0123456789abcdef',
  }

  it('pull control is configured without a bridge URL', () => {
    const env = { ...base, WHATSAPP_WEB_BRIDGE_CONTROL: 'pull' }
    expect(whatsappWebBridgeControlMode(env)).toBe('pull')
    expect(getWhatsAppWebBridgeConfigurationHealth(env)).toEqual({
      enabled: true,
      configured: true,
      missing: [],
      sessionIdConfigured: true,
      accountExternalId: 'waweb:primary',
      controlMode: 'pull',
    })
    // No URL → no direct transport: direct sends stay fail-closed.
    expect(getWhatsAppWebBridgeConfig(env)).toBeNull()
    expect(isConfiguredWhatsAppWebAccount('waweb:primary', env)).toBe(false)
  })

  it('pull control still needs ENABLED, SESSION_ID and both different secrets', () => {
    const env = { ...base, WHATSAPP_WEB_BRIDGE_CONTROL: 'pull' }
    expect(getWhatsAppWebBridgeConfigurationHealth({ ...env, WHATSAPP_WEB_BRIDGE_ENABLED: 'false' }))
      .toMatchObject({ configured: false, missing: ['WHATSAPP_WEB_BRIDGE_ENABLED'] })
    expect(getWhatsAppWebBridgeConfigurationHealth({ ...env, WHATSAPP_WEB_BRIDGE_SESSION_ID: '' }))
      .toMatchObject({ configured: false, missing: ['WHATSAPP_WEB_BRIDGE_SESSION_ID'] })
    expect(getWhatsAppWebBridgeConfigurationHealth({ ...env, WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: 'short' }))
      .toMatchObject({ configured: false, missing: ['WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET'] })
    expect(getWhatsAppWebBridgeConfigurationHealth({ ...env, WHATSAPP_WEB_BRIDGE_API_SECRET: base.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET }))
      .toMatchObject({ configured: false, missing: ['WHATSAPP_WEB_BRIDGE_SECRETS_MUST_DIFFER'] })
  })

  it('an unknown control value fails closed', () => {
    const env = { ...base, WHATSAPP_WEB_BRIDGE_CONTROL: 'pul', WHATSAPP_WEB_BRIDGE_URL: 'https://bridge.example.test' }
    expect(whatsappWebBridgeControlMode(env)).toBeNull()
    expect(getWhatsAppWebBridgeConfigurationHealth(env))
      .toMatchObject({ configured: false, missing: ['WHATSAPP_WEB_BRIDGE_CONTROL'] })
  })

  it('direct mode is unchanged: the URL is required and no controlMode key is reported', () => {
    expect(whatsappWebBridgeControlMode(base)).toBe('direct')
    expect(getWhatsAppWebBridgeConfigurationHealth(base)).toEqual({
      enabled: true,
      configured: false,
      missing: ['WHATSAPP_WEB_BRIDGE_URL'],
      sessionIdConfigured: true,
      accountExternalId: 'waweb:primary',
    })
    const withUrl = { ...base, WHATSAPP_WEB_BRIDGE_URL: 'https://bridge.example.test', WHATSAPP_WEB_BRIDGE_CONTROL: 'direct' }
    expect(getWhatsAppWebBridgeConfigurationHealth(withUrl)).toEqual({
      enabled: true,
      configured: true,
      missing: [],
      sessionIdConfigured: true,
      accountExternalId: 'waweb:primary',
    })
    expect(isConfiguredWhatsAppWebAccount('waweb:primary', withUrl)).toBe(true)
    expect(isConfiguredWhatsAppWebAccount('waweb:other', withUrl)).toBe(false)
  })
})
