import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  compactCommandCache,
  FixedWindowRateLimiter,
  isPermanentWebhookStatus,
  SerializedOperationQueue,
  settleWithin,
  WebhookOutbox,
} from '../../../services/whatsapp-web-bridge/bridge-reliability.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function directories() {
  const root = await mkdtemp(path.join(tmpdir(), 'wa-bridge-reliability-'))
  temporaryDirectories.push(root)
  return {
    root,
    outboxDir: path.join(root, 'outbox'),
    deadLetterDir: path.join(root, 'dead-letter'),
  }
}

function envelope(eventId: string) {
  return {
    version: 1,
    event_id: eventId,
    event_type: 'message',
    session_id: 'primary',
    message: {
      id: 'provider-message',
      remote_jid: '77000000000@s.whatsapp.net',
      timestamp_ms: 1_750_000_000_000,
      text: 'private text',
      message_type: 'text',
      live: true,
      from_me: false,
    },
  }
}

function validEnvelope(value: ReturnType<typeof envelope>, eventId: string) {
  return value?.event_id === eventId && value?.session_id === 'primary'
}

async function availablePort() {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()))
  })
  if (!port) throw new Error('failed to reserve a bridge test port')
  return port
}

function signedControlHeaders({
  secret,
  requestPath,
  nonce,
}: {
  secret: string
  requestPath: string
  nonce: string
}) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const bodyHash = createHash('sha256').update('').digest('hex')
  const canonical = [
    'v1',
    'GET',
    'whatsapp-web-bridge',
    requestPath,
    bodyHash,
    timestamp,
    nonce,
    'primary',
  ].join('\n')
  return {
    'x-wa-bridge-version': 'v1',
    'x-wa-bridge-audience': 'whatsapp-web-bridge',
    'x-wa-bridge-timestamp': timestamp,
    'x-wa-bridge-nonce': nonce,
    'x-wa-bridge-key-id': 'primary',
    'x-wa-bridge-signature': `sha256=${createHmac('sha256', secret).update(canonical).digest('hex')}`,
  }
}

async function waitForBridge(baseUrl: string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`bridge exited before readiness with code ${child.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // The listener may not have bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('bridge did not start before the test deadline')
}

async function stopBridge(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

describe('WhatsApp Web bridge reliability', () => {
  it('isolates trusted and public fixed-window rate-limit budgets', () => {
    let now = 1_000
    const publicLimiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      maxBuckets: 2,
      now: () => now,
    })
    const trustedLimiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      maxBuckets: 2,
      now: () => now,
    })

    expect(publicLimiter.consume('proxy')).toMatchObject({ allowed: true })
    expect(publicLimiter.consume('proxy')).toMatchObject({ allowed: true })
    expect(publicLimiter.consume('proxy')).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    })
    expect(trustedLimiter.consume('primary')).toMatchObject({ allowed: true })

    now += 60_000
    expect(publicLimiter.consume('proxy')).toMatchObject({ allowed: true })
  })

  it('does not let public or invalid traffic consume signed control-plane quota', async () => {
    const paths = await directories()
    const port = await availablePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const controlSecret = 'control-secret-for-test-only-000000000000'
    const child = spawn(
      process.execPath,
      [path.resolve('services/whatsapp-web-bridge/server.mjs')],
      {
        cwd: path.resolve('.'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: String(port),
          BRIDGE_SESSION_ID: 'primary',
          BRIDGE_API_KEY_ID: 'primary',
          BRIDGE_API_SECRET: controlSecret,
          BRIDGE_AUTH_DIR: path.join(paths.root, 'auth'),
          BRIDGE_STATE_DIR: path.join(paths.root, 'state'),
          BRIDGE_AUTOSTART: 'false',
          PORTAL_WEBHOOK_URL: `${baseUrl}/unused-webhook`,
          PORTAL_WEBHOOK_SECRET: 'portal-secret-for-test-only-0000000000000',
          PORTAL_JOB_DRAIN_URL: '',
          HTTP_RATE_PER_MINUTE: '10',
          COMMAND_CACHE_MAX_ENTRIES: '5000',
          SHUTDOWN_GRACE_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    try {
      await waitForBridge(baseUrl, child)

      const readiness = await fetch(`${baseUrl}/ready`)
      expect(readiness.status).toBe(503)
      await expect(readiness.json()).resolves.toMatchObject({
        checks: { idempotency_cache: true },
        idempotency_cache: {
          ready: true,
          entries: 0,
          max_entries: 5000,
          protected_entries: 0,
          saturated: false,
        },
      })

      // waitForBridge and /ready consumed two public requests. Eight more fit
      // that bucket and the next proves that only that bucket is saturated.
      for (let index = 0; index < 8; index += 1) {
        expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
      }
      expect((await fetch(`${baseUrl}/health`)).status).toBe(429)

      for (let index = 0; index < 12; index += 1) {
        expect((await fetch(`${baseUrl}/v1/session/status`)).status).toBe(401)
      }

      const requestPath = '/v1/session/status'
      const response = await fetch(`${baseUrl}${requestPath}`, {
        headers: signedControlHeaders({
          secret: controlSecret,
          requestPath,
          nonce: 'valid-nonce-0001',
        }),
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        session_id: 'primary',
      })
    } finally {
      await stopBridge(child)
    }
  })

  it('bounds rate-limit key cardinality with a throttled overflow bucket', () => {
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxBuckets: 2,
      now: () => 1_000,
    })

    expect(limiter.consume('one').allowed).toBe(true)
    expect(limiter.consume('two').allowed).toBe(true)
    expect(limiter.consume('three').allowed).toBe(true)
    expect(limiter.consume('four').allowed).toBe(false)
    expect(limiter.snapshot()).toEqual({ buckets: 2, overflow_active: true })
  })

  it('frees a slot at the exact command-cache boundary', () => {
    const entries = new Map([
      ['oldest', { status: 'sent', recorded_at: 1_000 }],
      ['middle', { status: 'sent', recorded_at: 2_000 }],
      ['latest', { status: 'sent', recorded_at: 3_000 }],
    ])

    expect(compactCommandCache(entries, {
      maxEntries: 3,
      ttlMs: 10_000,
      reserve: 1,
      now: 5_000,
    })).toMatchObject({
      available: true,
      size: 2,
      evictedSent: 1,
      protectedEntries: 0,
    })
    expect([...entries.keys()]).toEqual(['middle', 'latest'])
  })

  it('never evicts ambiguous command outcomes to make capacity', () => {
    const entries = new Map([
      ['sending', { status: 'sending', recorded_at: 1_000 }],
      ['unknown', { status: 'unknown', recorded_at: 1_000 }],
    ])

    expect(compactCommandCache(entries, {
      maxEntries: 2,
      ttlMs: 10,
      reserve: 1,
      now: 50_000,
    })).toMatchObject({
      available: false,
      size: 2,
      expiredSent: 0,
      evictedSent: 0,
      protectedEntries: 2,
    })
    expect([...entries.keys()]).toEqual(['sending', 'unknown'])
  })

  it('does not partially evict sent results when protected entries still block capacity', () => {
    const entries = new Map([
      ['sent', { status: 'sent', recorded_at: 49_000 }],
      ['unknown-one', { status: 'unknown', recorded_at: 1_000 }],
      ['unknown-two', { status: 'unknown', recorded_at: 1_000 }],
    ])

    expect(compactCommandCache(entries, {
      maxEntries: 2,
      ttlMs: 10_000,
      reserve: 1,
      now: 50_000,
    })).toMatchObject({
      available: false,
      size: 3,
      evictedSent: 0,
      protectedEntries: 2,
    })
    expect([...entries.keys()]).toEqual([
      'sent',
      'unknown-one',
      'unknown-two',
    ])
  })

  it('expires only known sent results and retains unknown tombstones', () => {
    const entries = new Map([
      ['sent', { status: 'sent', recorded_at: 1_000 }],
      ['unknown', { status: 'unknown', recorded_at: 1_000 }],
    ])

    expect(compactCommandCache(entries, {
      maxEntries: 3,
      ttlMs: 1_000,
      now: 3_000,
    })).toMatchObject({
      available: true,
      size: 1,
      expiredSent: 1,
      evictedSent: 0,
      protectedEntries: 1,
    })
    expect([...entries.keys()]).toEqual(['unknown'])
  })

  it('classifies only non-retryable 4xx responses as permanent', () => {
    expect(isPermanentWebhookStatus(400)).toBe(true)
    expect(isPermanentWebhookStatus(422)).toBe(true)
    expect(isPermanentWebhookStatus(408)).toBe(false)
    expect(isPermanentWebhookStatus(429)).toBe(false)
    expect(isPermanentWebhookStatus(500)).toBe(false)
  })

  it('atomically persists outbox entries with owner-only permissions', async () => {
    const paths = await directories()
    const outbox = new WebhookOutbox({
      ...paths,
      maxEntries: 10,
      validateEnvelope: validEnvelope,
      deliver: async () => ({ kind: 'delivered' }),
    })
    await outbox.initialize()

    const eventId = 'a'.repeat(64)
    await outbox.persist(envelope(eventId))

    const files = await readdir(paths.outboxDir)
    expect(files).toEqual([`${eventId}.json`])
    expect(JSON.parse(await readFile(path.join(paths.outboxDir, files[0]), 'utf8')))
      .toEqual(envelope(eventId))
    expect((await stat(path.join(paths.outboxDir, files[0]))).mode & 0o777).toBe(0o600)
    expect((await stat(paths.outboxDir)).mode & 0o777).toBe(0o700)
    expect((await stat(paths.deadLetterDir)).mode & 0o777).toBe(0o700)
  })

  it('quarantines a permanent 4xx and continues delivering later entries', async () => {
    const paths = await directories()
    const delivered: string[] = []
    const outbox = new WebhookOutbox({
      ...paths,
      maxEntries: 10,
      validateEnvelope: validEnvelope,
      deliver: async (value: ReturnType<typeof envelope>) => {
        delivered.push(value.event_id)
        return value.event_id.startsWith('a')
          ? { kind: 'permanent_failure', status: 422 }
          : { kind: 'delivered' }
      },
    })
    await outbox.initialize()
    await outbox.persist(envelope('a'.repeat(64)))
    await outbox.persist(envelope('b'.repeat(64)))

    await outbox.triggerDrain()

    expect(delivered).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(await readdir(paths.outboxDir)).toEqual([])
    const deadLetters = await readdir(paths.deadLetterDir)
    expect(deadLetters).toHaveLength(1)
    expect(deadLetters[0]).toContain('.permanent_rejection.json')
    expect((await stat(path.join(paths.deadLetterDir, deadLetters[0]))).mode & 0o777)
      .toBe(0o600)
    expect(outbox.snapshot()).toMatchObject({
      ready: true,
      outbox_depth: 0,
      last_webhook_error: { kind: 'permanent_rejection', status: 422 },
    })
    expect(outbox.snapshot().last_webhook_success_at).toEqual(expect.any(String))
  })

  it('serializes concurrent drain requests', async () => {
    const paths = await directories()
    let active = 0
    let maxActive = 0
    const outbox = new WebhookOutbox({
      ...paths,
      maxEntries: 10,
      validateEnvelope: validEnvelope,
      deliver: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return { kind: 'delivered' }
      },
    })
    await outbox.initialize()
    await outbox.persist(envelope('a'.repeat(64)))
    await outbox.persist(envelope('b'.repeat(64)))

    const first = outbox.triggerDrain()
    const second = outbox.triggerDrain()
    const third = outbox.triggerDrain()
    expect(second).toBe(first)
    expect(third).toBe(first)
    await Promise.all([first, second, third])

    expect(maxActive).toBe(1)
    expect(outbox.snapshot()).toMatchObject({
      ready: true,
      outbox_depth: 0,
      drain_in_flight: false,
    })
  })

  it('backpressures persistence and reports not-ready while saturated', async () => {
    const paths = await directories()
    let releaseDelivery!: () => void
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    let deliveryStarted!: () => void
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve
    })
    let deliveries = 0
    const outbox = new WebhookOutbox({
      ...paths,
      maxEntries: 1,
      validateEnvelope: validEnvelope,
      deliver: async () => {
        deliveries += 1
        if (deliveries === 1) {
          deliveryStarted()
          await deliveryGate
        }
        return { kind: 'delivered' }
      },
    })
    await outbox.initialize()
    await outbox.persist(envelope('a'.repeat(64)))
    expect(outbox.snapshot()).toMatchObject({
      ready: false,
      saturated: true,
      outbox_depth: 1,
    })

    let secondPersisted = false
    const second = outbox.persist(envelope('b'.repeat(64))).then(() => {
      secondPersisted = true
    })
    await started
    await Promise.resolve()
    expect(secondPersisted).toBe(false)

    releaseDelivery()
    await second
    expect(secondPersisted).toBe(true)
    expect(outbox.snapshot().outbox_depth).toBe(1)
    await outbox.triggerDrain()
    expect(outbox.snapshot()).toMatchObject({ ready: true, outbox_depth: 0 })
  })

  it('serializes auth writes, exposes health without error details, and recovers', async () => {
    const queue = new SerializedOperationQueue()
    queue.markInitialized()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = queue.enqueue(async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
    })
    const second = queue.enqueue(async () => {
      order.push('second')
    })
    expect(queue.snapshot()).toMatchObject({ ready: true, pending: 2 })
    releaseFirst()
    await Promise.all([first, second, queue.idle()])
    expect(order).toEqual(['first:start', 'first:end', 'second'])

    await expect(queue.enqueue(async () => {
      throw new Error('must not be exposed')
    })).rejects.toThrow('must not be exposed')
    await queue.idle()
    expect(queue.snapshot()).toMatchObject({
      ready: false,
      pending: 0,
      last_error: { kind: 'persist_failed' },
    })
    expect(queue.snapshot().last_error).not.toHaveProperty('message')

    await queue.enqueue(async () => undefined)
    expect(queue.snapshot()).toMatchObject({ ready: true, pending: 0 })
  })

  it('bounds graceful waiting', async () => {
    const never = new Promise<void>(() => undefined)
    const startedAt = Date.now()
    await expect(settleWithin([never], 20)).resolves.toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(500)
    await expect(settleWithin([Promise.resolve()], 20)).resolves.toBe(true)
  })
})
