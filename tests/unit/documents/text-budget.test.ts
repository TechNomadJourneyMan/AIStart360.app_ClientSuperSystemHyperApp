import { describe, expect, it } from 'vitest'
import { boundDocumentText } from '@/lib/documents/text-budget'

describe('boundDocumentText', () => {
  it('keeps small documents unchanged', () => {
    expect(boundDocumentText(' small text ', 100)).toBe('small text')
  })

  it('preserves the beginning and end of plain oversized documents', () => {
    const result = boundDocumentText(`START${'x'.repeat(500)}END`, 100)
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).toContain('START')
    expect(result).toContain('END')
  })

  it('samples every Excel sheet instead of only the first one', () => {
    const text = [
      `[Sheet: Dashboard]\nDASHBOARD-${'d'.repeat(500)}`,
      `[Sheet: Sales]\nSALES-${'s'.repeat(500)}`,
      `[Sheet: P&L]\nPROFIT-${'p'.repeat(500)}`,
    ].join('\n\n')
    const result = boundDocumentText(text, 750)
    expect(result.length).toBeLessThanOrEqual(750)
    expect(result).toContain('[Sheet: Dashboard]')
    expect(result).toContain('[Sheet: Sales]')
    expect(result).toContain('[Sheet: P&L]')
    expect(result).toContain('DASHBOARD')
    expect(result).toContain('SALES')
    expect(result).toContain('PROFIT')
  })
})
