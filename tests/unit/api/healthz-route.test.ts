/**
 * GET /api/healthz — the Railway deploy health check. It must answer while the
 * database stalls (/api/health returns 503 then), so it measures only that the
 * process is up and serving: no database, no Supabase, no config probe.
 * It also says which deployment answers (R4-A4, N4A-6): Railway's deployment
 * id, and the commit when Railway knows it (GitHub deploys only).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, dynamic } from '@/app/api/healthz/route'

describe('GET /api/healthz', () => {
  it('answers 200 { ok: true, uptimeS } without caching', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.uptimeS).toBe('number')
    expect(body.uptimeS).toBeGreaterThanOrEqual(0)
  })

  it('is evaluated per request', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  describe('what is deployed (N4A-6)', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('a `railway up` deploy: the deployment id, no commit (Railway sets the git SHA only for GitHub deploys)', async () => {
      vi.stubEnv('RAILWAY_DEPLOYMENT_ID', '7422C95B-1d2e-4f00-9a1b-0123456789ab')
      vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '')
      const body = await (await GET()).json()
      expect(body).toMatchObject({ ok: true, deploymentId: '7422c95b-1d2e-4f00-9a1b-0123456789ab', commit: null })
    })

    it('a GitHub deploy: the commit as well', async () => {
      vi.stubEnv('RAILWAY_DEPLOYMENT_ID', '7422c95b-1d2e-4f00-9a1b-0123456789ab')
      vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '91b68374aa0e1f2b3c4d5e6f708192a3b4c5d6e7')
      const body = await (await GET()).json()
      expect(body.commit).toBe('91b68374aa0e1f2b3c4d5e6f708192a3b4c5d6e7')
    })

    it('outside Railway (local, tests): both null, still ok', async () => {
      vi.stubEnv('RAILWAY_DEPLOYMENT_ID', '')
      vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '')
      const res = await GET()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, deploymentId: null, commit: null })
    })

    it('a value of the wrong shape is not echoed', async () => {
      vi.stubEnv('RAILWAY_DEPLOYMENT_ID', '<script>alert(1)</script>')
      vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'main; rm -rf /')
      const text = await (await GET()).text()
      expect(text).not.toContain('script')
      expect(text).not.toContain('rm -rf')
      expect(JSON.parse(text)).toMatchObject({ deploymentId: null, commit: null })
    })
  })

  it('does not depend on the database: imports no supabase, db or health module', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/api/healthz/route.ts'), 'utf8')
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect(spec, `forbidden import ${spec}`).not.toMatch(/^@\/lib\/(supabase|db|health)/)
    }
  })
})
