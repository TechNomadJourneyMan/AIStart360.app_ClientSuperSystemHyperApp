/**
 * tests/unit/crm/digest.test.ts — чистые хелперы CRM-дайджеста (Фаза 4A).
 */

import { describe, it, expect } from 'vitest'
import {
  selectChannels,
  pickWeakestBlock,
  buildDigestTitle,
  buildDigestLines,
  buildDigestBody,
  buildTelegramDigest,
  type DigestData,
} from '@/lib/crm/digest'

describe('selectChannels', () => {
  it('defaults every channel on when prefs are empty and address/chat exist', () => {
    expect(selectChannels({}, { hasEmail: true, hasTelegram: true })).toEqual({
      inApp: true,
      email: true,
      telegram: true,
    })
  })

  it('respects explicit opt-outs', () => {
    const prefs = { notifications: { crm: { in_app: false, email: false, telegram: true } } }
    expect(selectChannels(prefs, { hasEmail: true, hasTelegram: true })).toEqual({
      inApp: false,
      email: false,
      telegram: true,
    })
  })

  it('email/telegram require an address/chat regardless of prefs', () => {
    expect(selectChannels({}, { hasEmail: false, hasTelegram: false })).toEqual({
      inApp: true,
      email: false,
      telegram: false,
    })
  })

  it('tolerates junk prefs', () => {
    expect(selectChannels(null, { hasEmail: true, hasTelegram: false }).email).toBe(true)
    expect(selectChannels('nope', { hasEmail: true, hasTelegram: true }).telegram).toBe(true)
  })
})

describe('pickWeakestBlock', () => {
  it('returns the lowest-scoring block with a RU label', () => {
    expect(pickWeakestBlock({ 'cash-stability': 7.2, team: 3.1, operations: 5 })).toEqual({
      label: 'Команда',
      score: 3.1,
    })
  })

  it('ignores non-numeric values and returns null when empty', () => {
    expect(pickWeakestBlock({ team: 'x' })).toBeNull()
    expect(pickWeakestBlock({})).toBeNull()
    expect(pickWeakestBlock(null)).toBeNull()
  })
})

describe('digest text', () => {
  const data: DigestData = { overdue: 3, sleeping: 2, weakBlock: { label: 'Команда', score: 3.1 } }

  it('title pluralizes the total client count', () => {
    expect(buildDigestTitle({ overdue: 1, sleeping: 0, weakBlock: null })).toContain('1 клиент ждёт')
    expect(buildDigestTitle(data)).toContain('5 клиентов ждут')
  })

  it('lines carry counts and the weak GRI block', () => {
    const lines = buildDigestLines(data)
    expect(lines[0]).toContain('Просроченных напоминаний: 3')
    expect(lines[1]).toContain('Спящих клиентов: 2')
    expect(lines[2]).toContain('Команда (3.1/10)')
  })

  it('body is one flat string ending with the CTA hint', () => {
    expect(buildDigestBody(data)).toContain('Откройте раздел «Клиенты».')
  })

  it('telegram digest is HTML with a bold title and a link', () => {
    const html = buildTelegramDigest(data, 'https://app.example/pulse')
    expect(html).toContain('<b>')
    expect(html).toContain('<a href="https://app.example/pulse">')
  })

  it('telegram digest escapes html in dynamic parts', () => {
    const html = buildTelegramDigest(
      { overdue: 1, sleeping: 0, weakBlock: { label: '<b>x</b>', score: 1 } },
      '',
    )
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
})
