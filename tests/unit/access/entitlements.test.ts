/**
 * tests/unit/access/entitlements.test.ts — модель прав доступа (Фаза 6).
 */

import { describe, it, expect } from 'vitest'
import {
  entitlementsFor,
  normalizeTier,
  normalizeOverrides,
  canRunFullGri,
  can,
} from '@/lib/access/entitlements'

describe('entitlements', () => {
  it('free tier gates paid features and limits full GRI to 1 demo run', () => {
    const e = entitlementsFor('free')
    expect(e.pdf_export).toBe(false)
    expect(e.ai_chat).toBe(false)
    expect(e.benchmarks).toBe(false)
    expect(e.gri_full_limit).toBe(1)
    expect(canRunFullGri(e, 0)).toBe(true)
    expect(canRunFullGri(e, 1)).toBe(false)
  })

  it('pro tier unlocks everything with no GRI limit', () => {
    const e = entitlementsFor('pro')
    expect(can(e, 'pdf_export')).toBe(true)
    expect(can(e, 'ai_chat')).toBe(true)
    expect(can(e, 'benchmarks')).toBe(true)
    expect(canRunFullGri(e, 999)).toBe(true)
  })

  it('a per-user override grants a paid feature to a free user', () => {
    const e = entitlementsFor('free', { pdf_export: true })
    expect(e.pdf_export).toBe(true)
    expect(e.ai_chat).toBe(false)
  })

  it('an override can also revoke gri_full entirely', () => {
    const e = entitlementsFor('free', { gri_full: false })
    expect(canRunFullGri(e, 0)).toBe(false)
  })

  it('normalizeTier defaults unknown values to free', () => {
    expect(normalizeTier('pro')).toBe('pro')
    expect(normalizeTier('enterprise')).toBe('free')
    expect(normalizeTier(null)).toBe('free')
  })

  it('normalizeOverrides keeps only known boolean flags', () => {
    expect(normalizeOverrides({ pdf_export: true, junk: 1, ai_chat: 'yes' })).toEqual({
      pdf_export: true,
    })
    expect(normalizeOverrides(null)).toEqual({})
  })
})
