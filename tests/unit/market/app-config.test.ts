import { describe, it, expect } from 'vitest'
import { marketAppMisconfiguration } from '@/lib/market/app-config'

const PORTAL = 'https://portal.aistart360.app'

describe('marketAppMisconfiguration (E2E #4 — «refused to connect»)', () => {
  it('flags the portal pointing the embed at itself', () => {
    expect(marketAppMisconfiguration('https://portal.aistart360.app/?embed=1', PORTAL)).toMatch(/сам портал/)
  })

  it('flags the localhost default leaking into production', () => {
    expect(marketAppMisconfiguration('http://localhost:5173', PORTAL)).toMatch(/не задан/)
  })

  it('accepts localhost in local development and a proper external app', () => {
    expect(marketAppMisconfiguration('http://localhost:5173', 'http://localhost:3000')).toBeNull()
    expect(marketAppMisconfiguration('https://market.aistart360.app', PORTAL)).toBeNull()
  })

  it('flags garbage values', () => {
    expect(marketAppMisconfiguration('not a url', PORTAL)).toMatch(/корректным URL/)
  })
})
