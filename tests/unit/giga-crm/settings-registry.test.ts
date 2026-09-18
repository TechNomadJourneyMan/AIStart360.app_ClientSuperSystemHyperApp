import { describe, expect, it } from 'vitest'
import { SETTINGS, SETTING_KEYS, coerceSetting, validateSetting } from '@/lib/settings/registry'

describe('settings registry', () => {
  it('every default passes its own schema', () => {
    for (const k of SETTING_KEYS) expect(SETTINGS[k].schema.safeParse(SETTINGS[k].default).success, k).toBe(true)
  })

  it('missing or broken values fall back to defaults', () => {
    expect(coerceSetting('registration_mode', undefined)).toBe('approval')
    expect(coerceSetting('registration_mode', 'hack')).toBe('approval')
    expect(coerceSetting('auto_approve_clients', undefined)).toBe(true)
    expect(coerceSetting('access_gates', 'yes')).toBe(false)
    expect(coerceSetting('impersonation_ttl_minutes', 999)).toBe(30)
  })

  it('reads legacy shapes written by older code', () => {
    expect(coerceSetting('access_gates', { enabled: true })).toBe(true)
    expect(coerceSetting('registration_mode', { mode: 'open' })).toBe('open')
  })

  it('merges partial objects over defaults', () => {
    const n = coerceSetting('admin_notifications', { survey_completed: false })
    expect(n.survey_completed).toBe(false)
    expect(n.user_registered).toBe(true)
    expect(n.user_login).toBe(true)
    const a = coerceSetting('announcement', { enabled: true, text: 'Привет' })
    expect(a).toMatchObject({ enabled: true, text: 'Привет', tone: 'info' })
  })

  it('validates input', () => {
    expect(validateSetting('impersonation_ttl_minutes', 4).ok).toBe(false)
    expect(validateSetting('impersonation_ttl_minutes', 60).ok).toBe(true)
    expect(validateSetting('announcement', { enabled: true, text: '', tone: 'info', link_label: '', link_href: '' }).ok).toBe(false)
    expect(validateSetting('announcement', { enabled: false, text: '', tone: 'info', link_label: '', link_href: 'javascript:alert(1)' }).ok).toBe(false)
    expect(validateSetting('announcement', { enabled: true, text: 'Новости', tone: 'warning', link_label: 'Читать', link_href: '/client/content' }).ok).toBe(true)
    expect(validateSetting('registration_mode', 'closed').ok).toBe(false)
  })
})
