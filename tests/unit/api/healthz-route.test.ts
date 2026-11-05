/**
 * GET /api/healthz — the Railway deploy health check. It must answer while the
 * database stalls (/api/health returns 503 then), so it measures only that the
 * process is up and serving: no database, no Supabase, no config probe.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
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
