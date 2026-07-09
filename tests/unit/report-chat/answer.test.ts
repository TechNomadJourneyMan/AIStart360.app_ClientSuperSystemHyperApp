import { describe, it, expect } from 'vitest'
import { parseReportChatAnswer, sanitizeUsedSources } from '@/lib/ai/report-chat/answer'

const valid = {
  can_answer: true,
  answer: 'По вашим данным маржа 25%.',
  confidence: 'high',
  used_sources: [
    { type: 'gri_top5', ref: 'gri_top5:0', label: 'Ограничение №1' },
    { type: 'document', ref: 'doc:d1', label: 'P&L' },
  ],
}

describe('parseReportChatAnswer', () => {
  it('parses a well-formed structured answer', () => {
    const a = parseReportChatAnswer(valid, ['gri_top5:0', 'doc:d1'])
    expect(a).not.toBeNull()
    expect(a!.answer).toContain('маржа 25%')
    expect(a!.needs_expert).toBe(false) // defaulted
    expect(a!.suggested_next).toEqual([]) // defaulted
  })

  it('returns null for malformed output (missing required field)', () => {
    expect(parseReportChatAnswer({ answer: 'x', confidence: 'high' }, [])).toBeNull()
  })

  it('returns null when the answer exceeds the hard length cap', () => {
    expect(parseReportChatAnswer({ ...valid, answer: 'x'.repeat(3000) }, [])).toBeNull()
  })
})

describe('sanitizeUsedSources — deterministic source check', () => {
  it('drops citations to sources that were never provided to the model', () => {
    const a = parseReportChatAnswer(
      { ...valid, used_sources: [...valid.used_sources, { type: 'document', ref: 'doc:d9', label: 'Fake' }] },
      ['gri_top5:0', 'doc:d1'],
    )!
    const cleaned = sanitizeUsedSources(a, ['gri_top5:0', 'doc:d1'])
    const refs = cleaned.used_sources.map((s) => s.ref)
    expect(refs).toContain('gri_top5:0')
    expect(refs).toContain('doc:d1')
    expect(refs).not.toContain('doc:d9') // fabricated citation removed
  })

  it('keeps all citations when every ref was provided', () => {
    const a = parseReportChatAnswer(valid, ['gri_top5:0', 'doc:d1'])!
    expect(sanitizeUsedSources(a, ['gri_top5:0', 'doc:d1']).used_sources).toHaveLength(2)
  })
})
