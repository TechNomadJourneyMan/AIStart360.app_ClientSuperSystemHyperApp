/**
 * R-013 / R-135 — the CSP is built from env: our Supabase origin (+ wss for Realtime), no
 * *.supabase.co wildcard, «Рынок» only when configured (never loopback in a production build).
 */
import { describe, expect, it, vi } from 'vitest'
import { buildSecurityConfig, reportSecurityConfigWarnings } from '@/lib/security/csp.mjs'

const directive = (csp: string, name: string) =>
  csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

const PROD = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.aistart360.app',
  NEXT_PUBLIC_MARKET_APP_URL: 'https://market.aistart360.app/app',
}

describe('R-013 Supabase origin', () => {
  it('R-013: connect-src has the self-hosted Supabase origin and its wss:// twin', () => {
    const { csp, warnings } = buildSecurityConfig(PROD)
    const connect = directive(csp, 'connect-src')
    expect(connect).toContain('https://supabase.aistart360.app')
    expect(connect).toContain('wss://supabase.aistart360.app')
    expect(warnings).toEqual([])
  })

  it('R-013: no *.supabase.co wildcard anywhere (CSP or image patterns)', () => {
    const cfg = buildSecurityConfig(PROD)
    expect(cfg.csp).not.toContain('supabase.co')
    expect(JSON.stringify(cfg.remotePatterns)).not.toContain('supabase.co')
  })

  it('R-013: media-src and images.remotePatterns use the same origin', () => {
    const cfg = buildSecurityConfig(PROD)
    expect(directive(cfg.csp, 'media-src')).toBe("media-src 'self' https://supabase.aistart360.app")
    expect(cfg.remotePatterns[0]).toEqual({ protocol: 'https', hostname: 'supabase.aistart360.app', port: '' })
    expect(cfg.remotePatterns.some((p) => p.hostname === 'lh3.googleusercontent.com')).toBe(true)
  })

  it('R-013: a path or port in the URL is reduced to the origin; http gives ws://', () => {
    const cfg = buildSecurityConfig({ NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/' })
    expect(cfg.supabaseOrigin).toBe('http://127.0.0.1:54321')
    expect(cfg.supabaseRealtimeOrigin).toBe('ws://127.0.0.1:54321')
    expect(cfg.remotePatterns[0]).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: '54321' })
  })

  it('R-013: missing or invalid URL → no Supabase source and a loud warning', () => {
    for (const v of [undefined, '', 'not a url', 'javascript:alert(1)']) {
      const cfg = buildSecurityConfig({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: v })
      expect(cfg.supabaseOrigin).toBeNull()
      expect(directive(cfg.csp, 'connect-src')).not.toMatch(/supabase|wss:/)
      expect(cfg.warnings.join()).toContain('NEXT_PUBLIC_SUPABASE_URL')
    }
  })
})

describe('R-135 «Рынок» origin', () => {
  it('R-135: production build with a real market URL → frame-src and connect-src get its origin', () => {
    const { csp, marketOrigin } = buildSecurityConfig(PROD)
    expect(marketOrigin).toBe('https://market.aistart360.app')
    expect(directive(csp, 'frame-src')).toContain('https://market.aistart360.app')
    expect(directive(csp, 'connect-src')).toContain('https://market.aistart360.app')
  })

  it('R-135: production build never gets localhost:5173 (unset or loopback)', () => {
    const unset = buildSecurityConfig({ ...PROD, NEXT_PUBLIC_MARKET_APP_URL: undefined })
    expect(unset.csp).not.toContain('localhost')
    expect(unset.marketOrigin).toBeNull()
    const loop = buildSecurityConfig({ ...PROD, NEXT_PUBLIC_MARKET_APP_URL: 'http://localhost:5173' })
    expect(loop.csp).not.toContain('localhost')
    expect(loop.warnings.join()).toContain('NEXT_PUBLIC_MARKET_APP_URL')
  })

  it('R-135: development keeps the local Vite default', () => {
    const dev = buildSecurityConfig({ NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: PROD.NEXT_PUBLIC_SUPABASE_URL })
    expect(dev.marketOrigin).toBe('http://localhost:5173')
  })
})

describe('CSP invariants', () => {
  it('unsafe-eval only in development; frame-ancestors/object-src locked', () => {
    expect(directive(buildSecurityConfig(PROD).csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
    expect(directive(buildSecurityConfig({ ...PROD, NODE_ENV: 'development' }).csp, 'script-src')).toContain("'unsafe-eval'")
    const { csp } = buildSecurityConfig(PROD)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
  })

  it('warnings are printed as one block; nothing when clean', () => {
    const log = vi.fn()
    reportSecurityConfigWarnings([], log)
    expect(log).not.toHaveBeenCalled()
    reportSecurityConfigWarnings(['a', 'b'], log)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('  - a')
  })
})
