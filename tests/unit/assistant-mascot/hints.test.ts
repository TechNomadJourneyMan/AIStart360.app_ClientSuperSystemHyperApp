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

  it('welcome_back is a greeting-pose bubble with an open-chat action', () => {
    const wb = resolveHint(localCandidate('welcome_back')!)
    expect(wb?.state).toBe('greeting')
    expect(wb?.text).toContain('С возвращением')
    expect(wb?.actions.some((a) => a.kind === 'open_chat')).toBe(true)
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

  it('problem hints (Батч D) carry type=problem with working CTAs and honest copy', () => {
    const red = resolveHint({ id: 'red_zone', priority: 2, params: { block: 'Продажи' } })
    expect(red?.type).toBe('problem')
    expect(red?.text).toContain('«Продажи»')
    expect(red?.actions.find((a) => a.kind === 'navigate')?.href).toBe('/gri?tab=result')
    // Без блока — generic-текст, никакого "null".
    const redGeneric = resolveHint({ id: 'red_zone', priority: 2, params: { block: null } })
    expect(redGeneric?.text).not.toContain('null')

    const one = resolveHint({ id: 'clients_at_risk', priority: 2, params: { count: 1 } })
    expect(one?.text).toContain('1 клиент ')
    const few = resolveHint({ id: 'clients_at_risk', priority: 2, params: { count: 3 } })
    expect(few?.text).toContain('3 клиента')
    expect(few?.actions.find((a) => a.kind === 'navigate')?.href).toBe('/pulse')

    const pulse = resolveHint({ id: 'pulse_missed', priority: 3 })
    expect(pulse?.type).toBe('problem')
    expect(pulse?.actions.find((a) => a.kind === 'navigate')?.href).toBe('/pulse')

    // empty_metrics живёт только на /metrics и открывает чат Гри.
    const metrics = resolveHint({ id: 'empty_metrics', priority: 3 })!
    expect(metrics.type).toBe('problem')
    expect(metrics.actions.some((a) => a.kind === 'open_chat')).toBe(true)
    expect(screenAllowed(metrics, '/metrics')).toBe(true)
    expect(screenAllowed(metrics, '/dashboard')).toBe(false)
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

  it('character defaults to cat and rejects unknown skins; tutorialDone defaults false', () => {
    expect(normalizeMascotSettings({}).character).toBe('cat')
    expect(normalizeMascotSettings({ character: 'dragon' }).character).toBe('cat')
    expect(normalizeMascotSettings({ character: 'owl' }).character).toBe('owl')
    expect(normalizeMascotSettings({}).tutorialDone).toBe(false)
    expect(normalizeMascotSettings({ tutorialDone: true }).tutorialDone).toBe(true)
  })
})

describe('characters + greeting personalization', () => {
  it('greeting uses the character name from params', () => {
    const g = resolveHint({ id: 'greeting', priority: 0, params: { name: 'Капи' } })
    expect(g?.text).toContain('Я Капи')
    const fallback = resolveHint({ id: 'greeting', priority: 0 })
    expect(fallback?.text).toContain('Я Гри')
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

  it('emits problem candidates from the Батч D signals only when they are set', () => {
    const base = {
      completion: report({ status: 'completed' }),
      errorCount: 0,
      hasDiagnostic: true,
      griIndex: 4.2,
      topLimit: null,
    }
    const withProblems = computeServerHints({
      ...base,
      redZone: true,
      redZoneBlock: 'Финансы',
      clientsAtRisk: 2,
      pulseMissed: true,
      metricsEmpty: false,
    })
    expect(withProblems.find((h) => h.id === 'red_zone')?.params?.block).toBe('Финансы')
    expect(withProblems.find((h) => h.id === 'clients_at_risk')?.params?.count).toBe(2)
    expect(withProblems.some((h) => h.id === 'pulse_missed')).toBe(true)
    expect(withProblems.some((h) => h.id === 'empty_metrics')).toBe(false)

    // Без сигналов — ни одного проблемного кандидата (обратная совместимость).
    const problemIds = ['red_zone', 'clients_at_risk', 'pulse_missed', 'empty_metrics']
    expect(computeServerHints(base).some((h) => problemIds.includes(h.id))).toBe(false)
  })

  it('empty_metrics fires on its own signal even with no other candidates', () => {
    const hints = computeServerHints({
      completion: report({ status: 'not_started', sections: [section({ pct: 0 })] }),
      errorCount: 0,
      hasDiagnostic: false,
      griIndex: null,
      topLimit: null,
      metricsEmpty: true,
    })
    expect(hints).toEqual([{ id: 'empty_metrics', priority: 3 }])
  })
})

// ─── Character catalog sanity ────────────────────────────────────────────────
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '@/lib/assistant/mascot/characters'

describe('character catalog', () => {
  it('has all four skins with names, personas and welcomes', () => {
    expect(CHARACTER_IDS.sort()).toEqual(['capybara', 'cat', 'dog', 'owl'])
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id]
      expect(c.name.length).toBeGreaterThan(1)
      expect(c.persona.ru).toContain(c.name)
      expect(c.welcome).toContain(c.name)
    }
  })

  it('getCharacter falls back to the cat on junk', () => {
    expect(getCharacter('unicorn').id).toBe('cat')
    expect(getCharacter(undefined).id).toBe('cat')
    expect(getCharacter('dog').name).toBe('Арчи')
  })
})

// ─── v1.4: color + coachmark tours ───────────────────────────────────────────
import { TOURS, tourForScreen } from '@/lib/assistant/mascot/tours'

describe('color + tours settings', () => {
  it('color defaults to ginger and rejects junk', () => {
    expect(normalizeMascotSettings({}).color).toBe('ginger')
    expect(normalizeMascotSettings({ color: 'neon' }).color).toBe('ginger')
    expect(normalizeMascotSettings({ color: 'snow' }).color).toBe('snow')
  })

  it('toursDone is a capped string list', () => {
    expect(normalizeMascotSettings({}).toursDone).toEqual([])
    expect(
      normalizeMascotSettings({ toursDone: ['/dashboard', 42, '/gri'] }).toursDone,
    ).toEqual(['/dashboard', '/gri'])
  })
})

describe('coachmark tour catalog', () => {
  it('every tour step has a selector, title and text; every tour ends on the mascot', () => {
    for (const [screen, steps] of Object.entries(TOURS)) {
      expect(steps.length, screen).toBeGreaterThanOrEqual(2)
      for (const s of steps) {
        expect(s.selector.length, `${screen}: selector`).toBeGreaterThanOrEqual(2)
        expect(s.title.length, `${screen}: title`).toBeGreaterThan(2)
        expect(s.text.length, `${screen}: text`).toBeGreaterThan(10)
      }
      expect(steps[steps.length - 1].selector).toContain('открыть чат')
    }
  })

  it('tours exist for the key screens and unknown screens return null', () => {
    for (const screen of ['/dashboard', '/gri', '/client/onboarding', '/market']) {
      expect(tourForScreen(screen), screen).not.toBeNull()
    }
    expect(tourForScreen('/nope')).toBeNull()
  })
})
