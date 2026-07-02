/**
 * tests/unit/assistant-mascot/hints.test.ts — catalog resolution, screen
 * normalization and the server-side candidate derivation.
 */

import { describe, expect, it } from 'vitest'
import {
  localCandidate,
  normalizeScreen,
  resolveHint,
  screenAllowed,
  SCREEN_PANEL_SECTIONS,
  SCREEN_TIPS,
} from '@/lib/assistant/mascot/hints'
import { computeServerHints } from '@/lib/assistant/mascot/server-hints'
import { normalizeMascotSettings } from '@/lib/assistant/mascot/settings-server'
import { CHAT_SCRIPTS } from '@/lib/assistant/chat-scripts'
import type { CompletionReport, SectionCompletion } from '@/lib/assistant/types'

describe('normalizeScreen', () => {
  it('keeps the first two path segments', () => {
    expect(normalizeScreen('/client/onboarding/documents')).toBe('/client/onboarding')
    expect(normalizeScreen('/gri')).toBe('/gri')
    expect(normalizeScreen('/gri?tab=history#top')).toBe('/gri')
    expect(normalizeScreen('/')).toBe('/')
  })
})

describe('resolveHint / catalog', () => {
  it('substitutes params into finish_section with correct plural forms', () => {
    const one = resolveHint({
      id: 'finish_section',
      priority: 1,
      params: { sectionLabel: 'Финансы', missing: 1 },
    })
    expect(one?.text).toContain('«Финансы»')
    expect(one?.text).toContain('1 обязательное поле')

    const few = resolveHint({
      id: 'finish_section',
      priority: 1,
      params: { sectionLabel: 'Продажи', missing: 3 },
    })
    expect(few?.text).toContain('3 обязательных поля')

    const many = resolveHint({
      id: 'finish_section',
      priority: 1,
      params: { sectionLabel: 'Продажи', missing: 5 },
    })
    expect(many?.text).toContain('5 обязательных полей')
  })

  it('results_ready copy never invents a GRI when params are missing', () => {
    const r = resolveHint({ id: 'results_ready', priority: 3, params: { gri: null, topLimit: null } })
    expect(r?.text).toContain('Диагностика готова')
    expect(r?.text).not.toContain('null')
  })

  it('unknown ids resolve to null', () => {
    expect(resolveHint({ id: 'nope', priority: 1 })).toBeNull()
    expect(localCandidate('nope')).toBeNull()
  })

  it('ai_insight renders the prepared text and never crashes without it', () => {
    const withText = resolveHint({
      id: 'ai_insight',
      priority: 3,
      params: { text: 'GRI 6.2 — начните с удержания команды.' },
    })
    expect(withText?.text).toBe('GRI 6.2 — начните с удержания команды.')
    expect(withText?.actions.some((a) => a.kind === 'open_chat')).toBe(true)
    const withoutText = resolveHint({ id: 'ai_insight', priority: 3 })
    expect(withoutText?.text).toContain('чат')
  })

  it('greeting is allowed anywhere; survey hints only on the survey', () => {
    const greeting = resolveHint(localCandidate('greeting')!)!
    expect(screenAllowed(greeting, '/anything')).toBe(true)
    const edu = resolveHint(localCandidate('complex_section')!)!
    expect(screenAllowed(edu, '/dashboard')).toBe(false)
    expect(screenAllowed(edu, '/client/onboarding')).toBe(true)
  })
})

describe('panel page-context maps', () => {
  it('every mapped panel section exists in CHAT_SCRIPTS (no drift)', () => {
    const known = new Set(CHAT_SCRIPTS.map((s) => s.section))
    for (const [screen, sections] of Object.entries(SCREEN_PANEL_SECTIONS)) {
      for (const section of sections) {
        expect(known.has(section), `${screen} → «${section}» отсутствует в CHAT_SCRIPTS`).toBe(true)
      }
    }
  })

  it('tips are short enough for the panel card', () => {
    for (const tip of Object.values(SCREEN_TIPS)) {
      expect(tip.length).toBeLessThanOrEqual(160)
    }
  })
})

describe('normalizeMascotSettings — behavior', () => {
  it('defaults all behavior switches to on', () => {
    const s = normalizeMascotSettings({})
    expect(s.behavior).toEqual({ walking: true, sleep: true, aiInsights: true })
  })

  it('keeps explicit false values and drops junk', () => {
    const s = normalizeMascotSettings({
      behavior: { walking: false, sleep: 'нет', aiInsights: false, extra: 1 },
    })
    expect(s.behavior).toEqual({ walking: false, sleep: true, aiInsights: false })
  })
})

// ─── computeServerHints ──────────────────────────────────────────────────────

function section(over: Partial<SectionCompletion>): SectionCompletion {
  return {
    section: 's',
    label: 'Раздел',
    step: 1,
    pct: 0,
    missing_required: [],
    missing_recommended: [],
    required_total: 3,
    required_filled: 0,
    ...over,
  }
}

function report(over: Partial<CompletionReport>): CompletionReport {
  return {
    overall_pct: 50,
    sections: [],
    status: 'in_progress',
    missing_required: [],
    missing_recommended: [],
    ...over,
  }
}

describe('computeServerHints', () => {
  it('offers finish_section for the most-complete started section', () => {
    const completion = report({
      sections: [
        section({ section: 'a', label: 'Финансы', step: 2, pct: 66, missing_required: ['x'] }),
        section({ section: 'b', label: 'Продажи', step: 1, pct: 30, missing_required: ['y', 'z'] }),
        section({ section: 'c', label: 'Готово', step: 3, pct: 100 }),
      ],
    })
    const hints = computeServerHints({
      completion,
      errorCount: 0,
      hasDiagnostic: false,
      griIndex: null,
      topLimit: null,
    })
    const finish = hints.find((h) => h.id === 'finish_section')
    expect(finish?.params?.sectionLabel).toBe('Финансы')
    expect(finish?.priority).toBe(1)
    expect(hints.find((h) => h.id === 'continue_diagnostic')?.params?.left).toBe(2)
  })

  it('flags validation errors first', () => {
    const hints = computeServerHints({
      completion: report({}),
      errorCount: 2,
      hasDiagnostic: false,
      griIndex: null,
      topLimit: null,
    })
    expect(hints[0]).toMatchObject({ id: 'fix_errors', priority: 1, params: { count: 2 } })
  })

  it('offers run_analysis when ready and results_ready when GRI exists', () => {
    const ready = computeServerHints({
      completion: report({ status: 'ready_for_analysis' }),
      errorCount: 0,
      hasDiagnostic: false,
      griIndex: null,
      topLimit: null,
    })
    expect(ready.some((h) => h.id === 'run_analysis')).toBe(true)

    const results = computeServerHints({
      completion: report({ status: 'completed' }),
      errorCount: 0,
      hasDiagnostic: true,
      griIndex: 5.4,
      topLimit: 'Продажи',
    })
    expect(results.find((h) => h.id === 'results_ready')?.params).toMatchObject({
      gri: 5.4,
      topLimit: 'Продажи',
    })
  })

  it('is quiet when nothing is actionable', () => {
    const hints = computeServerHints({
      completion: report({ status: 'not_started', sections: [section({ pct: 0 })] }),
      errorCount: 0,
      hasDiagnostic: false,
      griIndex: null,
      topLimit: null,
    })
    expect(hints).toEqual([])
  })
})
