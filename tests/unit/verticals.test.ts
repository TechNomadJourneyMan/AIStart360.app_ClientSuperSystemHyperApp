import { describe, expect, it } from 'vitest'
import {
  getVertical,
  getVerticalUi,
  isValidVerticalId,
  parseVerticalId,
  VERTICALS,
  VERTICAL_IDS,
  VERTICAL_UI,
} from '@/lib/verticals'

describe('vertical registry', () => {
  it('accepts only the three exact persisted ids', () => {
    for (const id of VERTICAL_IDS) {
      expect(parseVerticalId(id)).toBe(id)
      expect(isValidVerticalId(id)).toBe(true)
    }

    for (const invalid of [
      null,
      undefined,
      '',
      ' medical ',
      'Medical',
      'store',
      'toString',
      'constructor',
      '__proto__',
      {},
    ]) {
      expect(parseVerticalId(invalid)).toBeNull()
      expect(isValidVerticalId(invalid)).toBe(false)
    }
  })

  it('falls back safely to generic for missing or corrupted values', () => {
    for (const invalid of [null, undefined, 'constructor', '__proto__', 'unknown']) {
      expect(getVertical(invalid).id).toBe('generic')
      expect(getVerticalUi(invalid).verticalNav).toBeNull()
    }
  })

  it('has an exhaustive UI config for every registered vertical', () => {
    expect(Object.keys(VERTICAL_UI).sort()).toEqual([...VERTICAL_IDS].sort())
    const registryIds = VERTICALS.map((vertical) => vertical.id)
    expect(new Set(registryIds).size).toBe(registryIds.length)
    expect([...registryIds].sort()).toEqual([...VERTICAL_IDS].sort())
    expect(VERTICAL_UI.medical.verticalNav?.href).toBe('/clinic')
    expect(VERTICAL_UI.medical.result).toBe('/clinic')
    expect(VERTICAL_UI.ecommerce.verticalNav?.href).toBe('/store')
    expect(VERTICAL_UI.generic.verticalNav).toBeNull()
  })
})
