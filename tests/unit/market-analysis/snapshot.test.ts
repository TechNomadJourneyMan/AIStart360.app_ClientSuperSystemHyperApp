import { describe, it, expect } from 'vitest'
import { buildSnapshot, type MarketAnswerRow } from '@/lib/market-analysis/snapshot'

const row = (question_key: string, answer_text: string): MarketAnswerRow => ({
  question_key,
  answer_text,
  source: 'user',
  status: 'confirmed',
  confidence: null,
})

describe('market snapshot — TAM/SAM/SOM tiles', () => {
  it('extracts a figure as the headline value', () => {
    const snap = buildSnapshot([row('A1', '1,2 млрд ₸ — рынок телеком-услуг РК')])
    expect(snap.tam?.value).toMatch(/1,2 млрд/)
    expect(snap.tam?.caption).toContain('телеком')
  })

  it('never promotes free text without digits into the number tile (E2E #12 «Fjkdlpdpd»)', () => {
    const snap = buildSnapshot([row('A1', 'Fjkdlpdpd'), row('A2', 'не знаю, надо считать')])
    expect(snap.tam?.value).toBe('—')
    expect(snap.tam?.caption).toBe('Fjkdlpdpd')
    expect(snap.sam?.value).toBe('—')
    expect(snap.sam?.delta).toBe('не знаю, надо считать')
  })
})
