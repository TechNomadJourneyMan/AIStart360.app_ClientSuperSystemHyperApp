/** «Сообщения» in the GIGA menu and the client cabinet; the «Общение» settings. */
import { describe, expect, it } from 'vitest'
import { GIGA_BASE, GIGA_NAV, gigaSectionTitle } from '@/lib/admin/nav'
import { hasPermission } from '@/lib/admin/rbac'
import { getPrimaryNavForRole } from '@/lib/navigation'
import { SETTINGS, SETTING_GROUPS, coerceSetting, validateSetting } from '@/lib/settings/registry'

describe('navigation', () => {
  it('GIGA: «Сообщения» opens the communications group, gated by inbox.view', () => {
    const group = GIGA_NAV.find((g) => g.label === 'Коммуникации')!
    expect(group.items[0]).toMatchObject({ href: `${GIGA_BASE}/messages`, label: 'Сообщения', permission: 'inbox.view' })
    expect(gigaSectionTitle(`${GIGA_BASE}/messages`)).toBe('Сообщения')
    expect(hasPermission('support', 'inbox.view')).toBe(true)
    expect(hasPermission('analyst', 'inbox.view')).toBe(false)
  })

  it('client cabinet: «Сообщения» for clients only', () => {
    expect(getPrimaryNavForRole('client').map((i) => i.href)).toContain('/client/messages')
    expect(getPrimaryNavForRole('admin').map((i) => i.href)).not.toContain('/client/messages')
  })
})

describe('«Общение» settings', () => {
  it('group, defaults from the design', () => {
    expect(SETTING_GROUPS.comm.label).toBe('Общение')
    const keys = Object.entries(SETTINGS).filter(([, s]) => s.group === 'comm').map(([k]) => k)
    expect(keys).toEqual(['comm_work_days', 'comm_work_from', 'comm_work_to', 'comm_timezone', 'comm_send_interval_seconds', 'comm_send_jitter_seconds', 'comm_escalation_minutes', 'comm_bot_auto_default'])
    expect(coerceSetting('comm_work_days', undefined)).toEqual([1, 2, 3, 4, 5])
    expect(coerceSetting('comm_work_from', undefined)).toBe('09:00')
    expect(coerceSetting('comm_work_to', undefined)).toBe('19:00')
    expect(coerceSetting('comm_timezone', undefined)).toBe('Asia/Almaty')
    expect(coerceSetting('comm_send_interval_seconds', undefined)).toBe(10)
    expect(coerceSetting('comm_send_jitter_seconds', undefined)).toBe(5)
    expect(coerceSetting('comm_escalation_minutes', undefined)).toBe(30)
    expect(coerceSetting('comm_bot_auto_default', undefined)).toBe(false)
  })

  it('validation', () => {
    expect(validateSetting('comm_work_days', [1, 3, 7]).ok).toBe(true)
    expect(validateSetting('comm_work_days', []).ok).toBe(false)
    expect(validateSetting('comm_work_days', [0]).ok).toBe(false)
    expect(coerceSetting('comm_work_days', [6, 7])).toEqual([6, 7])
    expect(validateSetting('comm_work_from', '9:00').ok).toBe(false)
    expect(validateSetting('comm_work_to', '23:59').ok).toBe(true)
    expect(validateSetting('comm_timezone', 'Mars/Olympus').ok).toBe(false)
    expect(validateSetting('comm_timezone', 'Europe/Moscow').ok).toBe(true)
    expect(validateSetting('comm_send_interval_seconds', 1).ok).toBe(false)
    expect(validateSetting('comm_escalation_minutes', 60).ok).toBe(true)
  })
})
