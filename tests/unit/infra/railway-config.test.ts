/**
 * railway.json — Railway's config-as-code for the portal service. What it must guarantee:
 * a deploy only takes traffic once /api/healthz answers, the old instance is given time to finish
 * (overlap for in-flight HTTP requests, draining for background work after SIGTERM), the server is
 * started by `node` itself (npm would sit between Railway's SIGTERM and Next), and the service
 * runs as ONE replica in Amsterdam (two replicas would run every in-process cron job twice).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FILE = path.resolve(__dirname, '../../../railway.json')

// Only what the tests look at; the file may carry more.
interface RailwayConfig {
  $schema?: string
  build?: { builder?: string; buildCommand?: string }
  deploy?: {
    startCommand?: string
    preDeployCommand?: string[]
    healthcheckPath?: string
    healthcheckTimeout?: number
    restartPolicyType?: string
    drainingSeconds?: number
    overlapSeconds?: number
    multiRegionConfig?: Record<string, { numReplicas?: number }>
  }
}

const config = JSON.parse(readFileSync(FILE, 'utf8')) as RailwayConfig
const deploy = config.deploy ?? {}

describe('railway.json', () => {
  it('points at the Railway schema, so an editor validates the field names', () => {
    expect(config.$schema).toBe('https://railway.com/railway.schema.json')
  })

  it('builds with Railpack through the project build script', () => {
    expect(config.build?.builder).toBe('RAILPACK')
    expect(config.build?.buildCommand).toBe('npm run build')
  })

  it('only takes traffic after /api/healthz answers, and waits long enough for a cold start', () => {
    expect(deploy.healthcheckPath).toBe('/api/healthz')
    expect(deploy.healthcheckTimeout).toBe(300)
  })

  it('gives the old instance time to finish: draining for background work, overlap for in-flight requests', () => {
    // the server waits up to 55 s for background work on SIGTERM (lib/runtime/server-start.ts)
    expect(deploy.drainingSeconds).toBeGreaterThanOrEqual(60)
    // after traffic moves to the new deployment the old one keeps serving requests already in flight
    expect(deploy.overlapSeconds).toBeGreaterThanOrEqual(45)
  })

  it('starts Next with node directly, never through npm (which would swallow the SIGTERM)', () => {
    expect(deploy.startCommand).toBeDefined()
    expect(deploy.startCommand!.startsWith('node ')).toBe(true)
    expect(deploy.startCommand).not.toMatch(/\bnpm\b/)
    // Railway routes to the container, so Next must listen on all interfaces; PORT it reads itself
    expect(deploy.startCommand).toContain('-H 0.0.0.0')
    expect(deploy.startCommand).not.toMatch(/(^|\s)-p\s/)
  })

  it('prepares the Workflow queue tables before each deploy', () => {
    expect(deploy.preDeployCommand).toEqual(['node scripts/railway/predeploy.mjs'])
  })

  it('restarts a crashed server, but not one that was stopped on purpose', () => {
    expect(deploy.restartPolicyType).toBe('ON_FAILURE')
  })

  it('runs in a single region with a single replica (the in-process cron must not run twice)', () => {
    expect(Object.keys(deploy.multiRegionConfig ?? {})).toEqual(['europe-west4-drams3a'])
    expect(deploy.multiRegionConfig!['europe-west4-drams3a'].numReplicas).toBe(1)
  })
})
