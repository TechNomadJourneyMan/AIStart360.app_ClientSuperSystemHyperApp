import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'

/**
 * End-to-end smoke of server.mjs in PORTAL_CONTROL_MODE=pull against a fake
 * portal: the bridge pushes a signed status without being asked, claims a
 * logout command, executes it locally (no WhatsApp network: no socket is open)
 * and acks it under the lease token.
 */

const portalSecret = 'portal-secret-for-pull-control-test-0000000'
const commandId = '00000000-0000-4000-8000-0000000000c1'
const leaseToken = '00000000-0000-4000-8000-0000000000c2'
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  // Reverse order: stop the bridge before its state directory is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

describe('WhatsApp Web bridge — pull control end to end', () => {
  it('pushes status, claims a command, executes it and acks it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wa-bridge-pull-control-'))
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))

    const received: Array<{ path: string; body: Record<string, unknown> }> = []
    let claims = 0
    const portal = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const raw = await readBody(req)
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value)
        }
        const verified = verifySignedBridgeRequest({
          method: req.method ?? 'POST',
          path: pathname,
          body: raw,
          headers,
          expectedAudience: WHATSAPP_WEB_PORTAL_AUDIENCE,
          secrets: { primary: portalSecret },
        })
        const reply = (status: number, value: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(value))
        }
        if (!verified.ok) return reply(401, { ok: false })
        const body = JSON.parse(raw) as Record<string, unknown>
        received.push({ path: pathname, body })
        if (pathname.endsWith('/commands/claim')) {
          claims += 1
          return reply(200, {
            ok: true,
            command: claims === 1
              ? { command_id: commandId, action: 'logout', lease_token: leaseToken, expires_at: new Date(Date.now() + 120_000).toISOString() }
              : null,
          })
        }
        if (pathname.endsWith('/commands/ack')) return reply(200, { ok: true, accepted: true })
        return reply(200, { ok: true })
      })()
    })
    await new Promise<void>((resolve) => portal.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => portal.close(() => resolve())))
    const address = portal.address()
    const portalPort = typeof address === 'object' && address ? address.port : 0

    const bridgeProbe = createServer()
    await new Promise<void>((resolve) => bridgeProbe.listen(0, '127.0.0.1', resolve))
    const bridgeAddress = bridgeProbe.address()
    const bridgePort = typeof bridgeAddress === 'object' && bridgeAddress ? bridgeAddress.port : 0
    await new Promise<void>((resolve) => bridgeProbe.close(() => resolve()))

    const child = spawn(
      process.execPath,
      [path.resolve('services/whatsapp-web-bridge/server.mjs')],
      {
        cwd: path.resolve('.'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: String(bridgePort),
          BRIDGE_SESSION_ID: 'primary',
          BRIDGE_API_SECRET: 'control-secret-for-pull-control-test-00000',
          BRIDGE_AUTH_DIR: path.join(root, 'auth'),
          BRIDGE_STATE_DIR: path.join(root, 'state'),
          BRIDGE_AUTOSTART: 'true',
          PORTAL_WEBHOOK_URL: `http://127.0.0.1:${portalPort}/api/webhooks/whatsapp-web`,
          PORTAL_WEBHOOK_SECRET: portalSecret,
          PORTAL_JOB_DRAIN_URL: '',
          WHATSAPP_WEB_DELIVERY_MODE: 'direct',
          PORTAL_CONTROL_MODE: 'pull',
          PORTAL_CONTROL_FAST_POLL_MS: '1000',
          PORTAL_CONTROL_IDLE_POLL_MS: '2000',
          SHUTDOWN_GRACE_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    cleanups.push(async () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5_000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    })

    const deadline = Date.now() + 8_000
    while (Date.now() < deadline && !received.some((call) => call.path.endsWith('/commands/ack'))) {
      if (child.exitCode !== null) throw new Error(`bridge exited: ${output}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const status = received.find((call) => call.path === '/api/webhooks/whatsapp-web/session')
    expect(status?.body).toMatchObject({
      version: 1,
      session_id: 'primary',
      state: 'disconnected',
      connected: false,
      qr: null,
    })
    const ack = received.find((call) => call.path.endsWith('/commands/ack'))
    expect(ack?.body).toEqual({
      version: 1,
      session_id: 'primary',
      command_id: commandId,
      lease_token: leaseToken,
      outcome: 'succeeded',
    })
    expect(output).toContain('portal_session_control_started')
  }, 15_000)
})
