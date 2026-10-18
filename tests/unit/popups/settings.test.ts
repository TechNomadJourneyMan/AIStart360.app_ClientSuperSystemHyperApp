import { describe, expect, it } from 'vitest'
import { SETTINGS, SETTING_GROUPS, coerceSetting, validateSetting } from '@/lib/settings/registry'

describe('«Точка Б» pop-up settings', () => {
  it('group, defaults', () => {
    expect(SETTING_GROUPS.point_b.label).toBe('Точка Б')
    const keys = Object.entries(SETTINGS).filter(([, s]) => s.group === 'point_b').map(([k]) => k)
    expect(keys).toContain('pb_popups_enabled')
    expect(keys).toContain('pb_popup_cards_per_day')
    expect(coerceSetting('pb_popups_enabled', undefined)).toBe(true)
    expect(coerceSetting('pb_popup_cards_per_day', undefined)).toBe(3)
    expect(coerceSetting('pb_popup_cards_per_day', 'many')).toBe(3)
  })

  it('validation', () => {
    expect(validateSetting('pb_popup_cards_per_day', 0).ok).toBe(true)
    expect(validateSetting('pb_popup_cards_per_day', 11).ok).toBe(false)
    expect(validateSetting('pb_popup_cards_per_day', 2.5).ok).toBe(false)
  })
})
