/**
 * R4-B4 (R-027): the survey modes are a GIGA setting, not the build flag
 * NEXT_PUBLIC_SURVEY_MODES.
 *   - registry `survey_modes` (express on/off + the mode offered first), the chat = survey_chat_enabled;
 *   - the server reads it (lib/survey/modes-server.ts) and hands it to the screens
 *     (app/client/onboarding/layout.tsx → SurveyModesContext);
 *   - the server pages of express / snapshot / blocks / chat send a switched-off
 *     mode to the full questionnaire with `?off=` (a notice — not a 404, not a loop);
 *   - a new client sees the chooser with the default mode first, «Рекомендуем»;
 *   - the way to the full questionnaire is always in sight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SurveyModesConfig } from '@/lib/survey/modes'

const s = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  storeFails: false,
  search: '' as string,
  redirects: [] as string[],
}))

vi.mock('@/lib/settings/store', async () => {
  const { coerceSetting } = await import('@/lib/settings/registry')
  return {
    getSetting: async (key: string) => {
      if (s.storeFails) throw new Error('db down')
      return coerceSetting(key as never, s.stored[key])
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(s.search),
  usePathname: () => '/client/onboarding',
  redirect: (to: string) => { s.redirects.push(to); throw new Error(`NEXT_REDIRECT ${to}`) },
}))
vi.mock('next/image', () => ({ default: (p: { alt: string; src: string }) => React.createElement('img', { alt: p.alt, src: p.src }) }))
vi.mock('@/lib/events/client', () => ({ track: () => {} }))
// The heavy client screens behind the server pages: stubs (the pages only decide whether to render them).
vi.mock('@/components/onboarding/express/ExpressFlow', () => ({ ExpressFlow: () => React.createElement('div', null, 'EXPRESS') }))
vi.mock('@/components/onboarding/express/SnapshotScreen', () => ({ SnapshotScreen: () => React.createElement('div', null, 'SNAPSHOT') }))
vi.mock('@/components/onboarding/chat/SurveyChat', () => ({ SurveyChat: () => React.createElement('div', null, 'CHAT') }))
vi.mock('@/components/onboarding/blocks/BlockScreens', () => ({
  BlocksListScreen: () => React.createElement('div', null, 'BLOCKS'),
  BlockScreen: ({ id }: { id: string }) => React.createElement('div', null, `BLOCK ${id}`),
}))

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

beforeEach(() => {
  s.stored = {}
  s.storeFails = false
  s.search = ''
  s.redirects = []
})

describe('registry: survey_modes', () => {
  it('a setting of the group «Анкета»; default = the PO decision (full + express, express first)', async () => {
    const { SETTINGS, SETTING_GROUPS, coerceSetting, validateSetting } = await import('@/lib/settings/registry')
    expect(SETTINGS.survey_modes.group).toBe('survey')
    expect(SETTING_GROUPS.survey.label).toBe('Анкета')
    expect(SETTINGS.survey_chat_enabled.group).toBe('survey')
    expect(coerceSetting('survey_modes', undefined)).toEqual({ express: true, default_mode: 'express' })
    expect(coerceSetting('survey_modes', { express: false })).toEqual({ express: false, default_mode: 'express' })
    expect(coerceSetting('survey_modes', { express: 'yes', default_mode: 'paper' })).toEqual({ express: true, default_mode: 'express' })
    expect(validateSetting('survey_modes', { express: true, default_mode: 'chat' }).ok).toBe(true)
    expect(validateSetting('survey_modes', { express: true, default_mode: 'paper' }).ok).toBe(false)
    // the chat has no switch of its own here — it is survey_chat_enabled
    expect(Object.keys(SETTINGS.survey_modes.default)).toEqual(['express', 'default_mode'])
  })
})

describe('resolveSurveyModes / withoutSwitchedOff / surveyModeOffRedirect', () => {
  it('full is always on; express by the setting; the chat by the AI helper; the default falls back to express, then full', async () => {
    const { resolveSurveyModes, DEFAULT_SURVEY_MODES_CONFIG } = await import('@/lib/survey/modes')
    expect(DEFAULT_SURVEY_MODES_CONFIG).toEqual({ enabled: ['full', 'express', 'chat'], defaultMode: 'express' })
    expect(resolveSurveyModes({ express: true, default_mode: 'express' }, false)).toEqual({ enabled: ['full', 'express'], defaultMode: 'express' })
    expect(resolveSurveyModes({ express: false, default_mode: 'express' }, true)).toEqual({ enabled: ['full', 'chat'], defaultMode: 'full' })
    expect(resolveSurveyModes({ express: true, default_mode: 'chat' }, false)).toEqual({ enabled: ['full', 'express'], defaultMode: 'express' })
    expect(resolveSurveyModes({ express: false, default_mode: 'chat' }, false)).toEqual({ enabled: ['full'], defaultMode: 'full' })
    expect(resolveSurveyModes({ express: true, default_mode: 'full' }, true).defaultMode).toBe('full')
    expect(resolveSurveyModes(null, true)).toEqual(DEFAULT_SURVEY_MODES_CONFIG)
  })

  it('`?off=` drops that mode from an older list (never «full»); the server page of an off mode → the full questionnaire with ?off=', async () => {
    const { withoutSwitchedOff, surveyModeOffRedirect } = await import('@/lib/survey/modes')
    const all: SurveyModesConfig = { enabled: ['full', 'express', 'chat'], defaultMode: 'express' }
    expect(withoutSwitchedOff(all, 'express')).toEqual({ enabled: ['full', 'chat'], defaultMode: 'full' })
    expect(withoutSwitchedOff(all, 'full')).toBe(all)
    expect(withoutSwitchedOff(all, 'paper')).toBe(all)
    expect(withoutSwitchedOff(all, null)).toBe(all)
    expect(surveyModeOffRedirect('express', { enabled: ['full', 'chat'] })).toBe('/client/onboarding?off=express')
    expect(surveyModeOffRedirect('chat', { enabled: ['full', 'express'] })).toBe('/client/onboarding?off=chat')
    expect(surveyModeOffRedirect('express', all)).toBeNull()
  })

  it('W3B-7: which links open a mode page — express / snapshot / blocks are the express, the chat page is the chat', async () => {
    const { surveyModeOfHref, surveyHrefOpen } = await import('@/lib/survey/modes')
    expect(surveyModeOfHref('/client/onboarding/express')).toBe('express')
    expect(surveyModeOfHref('/client/onboarding/snapshot?fresh=1')).toBe('express')
    expect(surveyModeOfHref('/client/onboarding/blocks/b3')).toBe('express')
    expect(surveyModeOfHref('/client/onboarding/chat')).toBe('chat')
    expect(surveyModeOfHref('/client/onboarding?step=1')).toBeNull()
    expect(surveyModeOfHref('/client/onboarding/answers')).toBeNull()
    expect(surveyModeOfHref('/client/onboarding/expressive')).toBeNull()
    expect(surveyHrefOpen('/client/onboarding/express', ['full', 'chat'])).toBe(false)
    expect(surveyHrefOpen('/client/onboarding?step=1', ['full'])).toBe(true)
  })

  it('a new client is recommended the default mode of the setting; anyone who started — the full questionnaire', async () => {
    const { resolveSurveyEntry, recommendedSurveyMode } = await import('@/lib/survey/modes')
    const ALL = ['full', 'express', 'chat'] as const
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ALL, defaultMode: 'chat' })).toEqual({ screen: 'chooser', recommended: 'chat' })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ALL, defaultMode: 'express' })).toEqual({ screen: 'chooser', recommended: 'express' })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 0, available: ['full', 'express'], defaultMode: 'chat' })).toEqual({ screen: 'chooser', recommended: 'express' })
    // current clients are not moved: a saved choice and the started full questionnaire stay
    expect(resolveSurveyEntry({ preference: { mode: 'full' }, answeredCount: 0, available: ALL, defaultMode: 'express' })).toEqual({ screen: 'mode', mode: 'full', banner: false })
    expect(resolveSurveyEntry({ preference: {}, answeredCount: 30, available: ALL, defaultMode: 'express' })).toEqual({ screen: 'mode', mode: 'full', banner: true })
    expect(recommendedSurveyMode(3, ALL, 'chat')).toBe('full')
  })

  it('the build flag decides nothing any more: no process.env in the modes and their screens', async () => {
    vi.stubEnv('NEXT_PUBLIC_SURVEY_MODES', 'full,express,chat')
    try {
      const { enabledSurveyModes, availableSurveyModes } = await import('@/lib/survey/modes')
      expect(enabledSurveyModes()).toEqual(['full'])
      expect(availableSurveyModes()).toEqual(['full'])
    } finally {
      vi.unstubAllEnvs()
    }
    for (const f of [
      'lib/survey/modes.ts', 'app/client/onboarding/page.tsx', 'components/onboarding/modes/SurveyModeGate.tsx',
      'components/onboarding/express/ModeTwoChrome.tsx', 'components/onboarding/chat/SurveyChat.tsx',
      'components/onboarding/express/SnapshotScreen.tsx', 'lib/client-shell/free-step.ts',
    ]) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain('process.env')
      expect(src, f).not.toMatch(/enabledSurveyModes\(\)/)
    }
  })
})

describe('getSurveyModes (server)', () => {
  it('no stored row → the PO default; GIGA values are read; the AI helper off → no chat; a failed read → the default', async () => {
    const { getSurveyModes, freeSnapshotAvailable } = await import('@/lib/survey/modes-server')
    expect(await getSurveyModes()).toEqual({ enabled: ['full', 'express', 'chat'], defaultMode: 'express' })
    s.stored = { survey_modes: { express: false, default_mode: 'express' }, survey_chat_enabled: false }
    expect(await getSurveyModes()).toEqual({ enabled: ['full'], defaultMode: 'full' })
    expect(await freeSnapshotAvailable()).toBe(false)
    s.stored = { survey_modes: { express: true, default_mode: 'full' } }
    expect(await getSurveyModes()).toEqual({ enabled: ['full', 'express', 'chat'], defaultMode: 'full' })
    s.storeFails = true
    expect(await getSurveyModes()).toEqual({ enabled: ['full', 'express', 'chat'], defaultMode: 'express' })
    expect(await freeSnapshotAvailable()).toBe(true)
  })
})

describe('the server pages of the modes', () => {
  const pages = [
    ['express', '@/app/client/onboarding/express/page', 'EXPRESS', '/client/onboarding?off=express'],
    ['snapshot', '@/app/client/onboarding/snapshot/page', 'SNAPSHOT', '/client/onboarding?off=express'],
    ['blocks', '@/app/client/onboarding/blocks/page', 'BLOCKS', '/client/onboarding?off=express'],
    ['chat', '@/app/client/onboarding/chat/page', 'CHAT', '/client/onboarding?off=chat'],
  ] as const

  it.each(pages)('%s: rendered while the mode is on', async (_n, path, marker) => {
    const { default: Page } = await import(path)
    expect(html(await Page())).toContain(marker)
    expect(s.redirects).toEqual([])
  })

  it.each(pages)('%s: switched off in GIGA → the full questionnaire with a notice (?off=), not a 404', async (_n, path, _m, to) => {
    s.stored = { survey_modes: { express: false, default_mode: 'express' }, survey_chat_enabled: false }
    const { default: Page } = await import(path)
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT')
    expect(s.redirects).toEqual([to])
  })

  it('one block page too', async () => {
    const { default: Page } = await import('@/app/client/onboarding/blocks/[block]/page')
    expect(html(await Page({ params: { block: 'b3' } }))).toContain('BLOCK b3')
    s.stored = { survey_modes: { express: false, default_mode: 'full' } }
    await expect(Page({ params: { block: 'b3' } })).rejects.toThrow('NEXT_REDIRECT')
    expect(s.redirects).toEqual(['/client/onboarding?off=express'])
  })

  it('the onboarding layout hands the server value to the screens', async () => {
    const { default: Layout } = await import('@/app/client/onboarding/layout')
    const { SurveyModesProvider } = await import('@/components/onboarding/modes/SurveyModesContext')
    s.stored = { survey_modes: { express: true, default_mode: 'express' }, survey_chat_enabled: false }
    const el = await Layout({ children: React.createElement('i', null, 'child') })
    expect(el.type).toBe(SurveyModesProvider)
    expect(el.props.value).toEqual({ enabled: ['full', 'express'], defaultMode: 'express' })
  })
})

describe('screens read the server value', () => {
  const provide = async (value: SurveyModesConfig, child: React.ReactElement) => {
    const { SurveyModesProvider } = await import('@/components/onboarding/modes/SurveyModesContext')
    return React.createElement(SurveyModesProvider, { value } as React.ComponentProps<typeof SurveyModesProvider>, child)
  }

  it('the chooser: the default mode first, «Рекомендуем», switched-off modes not shown (no «Скоро»)', async () => {
    const { SurveyModeChooser } = await import('@/components/onboarding/modes/SurveyModeChooser')
    const out = html(React.createElement(SurveyModeChooser, { enabled: ['full', 'express', 'chat'], recommended: 'express', onChoose: () => {} }))
    const order = Array.from(out.matchAll(/data-mode="(\w+)"/g)).map((m) => m[1])
    expect(order).toEqual(['express', 'full', 'chat'])
    expect(out.match(/Рекомендуем/g)).toHaveLength(1)
    expect(out.indexOf('Рекомендуем')).toBeLessThan(out.indexOf('Расширенная полная анкета'))
    expect(out).not.toContain('Скоро')
    expect(out).toContain('Полная анкета доступна всегда.')
    const two = html(React.createElement(SurveyModeChooser, { enabled: ['full', 'express'], recommended: 'express', onChoose: () => {} }))
    expect(two).not.toContain('Диагностическая беседа с ИИ')
    expect(two).toContain('md:grid-cols-2')
  })

  it('the gate: a mode page sent the client back (?off=express) → the notice and the full questionnaire, no loop', async () => {
    const { SurveyModeGate } = await import('@/components/onboarding/modes/SurveyModeGate')
    s.search = 'off=express'
    const out = html(await provide({ enabled: ['full', 'express'], defaultMode: 'express' }, React.createElement(SurveyModeGate, null, React.createElement('p', null, 'FULL'))))
    expect(out).toContain('«Экспресс + блоки» сейчас недоступен')
    expect(out).toContain('FULL')
    expect(out).not.toContain('aria-busy')
  })

  it('the gate: with more than one mode from the server it decides the entry (waits for the client data)', async () => {
    const { SurveyModeGate } = await import('@/components/onboarding/modes/SurveyModeGate')
    const many = html(await provide({ enabled: ['full', 'express'], defaultMode: 'express' }, React.createElement(SurveyModeGate, null, React.createElement('p', null, 'FULL'))))
    expect(many).toContain('aria-busy="true"')
    const one = html(await provide({ enabled: ['full'], defaultMode: 'full' }, React.createElement(SurveyModeGate, null, React.createElement('p', null, 'FULL'))))
    expect(one).toContain('FULL')
  })

  it('the express frame: the switch shows the server modes and «Перейти к полной анкете» is always there', async () => {
    const { ModeTwoChrome } = await import('@/components/onboarding/express/ModeTwoChrome')
    const survey = {
      loaded: true, answers: {}, attribution: {}, companyId: null, companyName: null, saveState: 'idle', savedAt: null, error: null,
      fieldIssue: null, staleKeys: [], dirtyKeys: [], userId: 'u', change: () => {}, save: async () => ({ ok: true }), dismissStale: () => {},
    } as const
    const out = html(await provide({ enabled: ['full', 'express'], defaultMode: 'express' }, React.createElement(ModeTwoChrome, { survey, current: 'express' } as unknown as React.ComponentProps<typeof ModeTwoChrome>, 'X')))
    expect(out).toMatch(/aria-pressed="true"[^>]*>Экспресс</)
    expect(out).toMatch(/aria-pressed="false"[^>]*>Полная</)
    expect(out).not.toContain('>Беседа<')
    expect(out).toContain('Перейти к полной анкете')
  })

  it('the full questionnaire and the chat take the modes from the context; the helper button follows the chat', () => {
    const page = readFileSync('app/client/onboarding/page.tsx', 'utf8')
    expect(page).toContain('withoutSwitchedOff(useSurveyModes(), searchParams.get(\'off\')).enabled')
    expect(page).toContain("enabled={surveyModes.includes('chat')}")
    expect(readFileSync('components/onboarding/chat/SurveyChat.tsx', 'utf8')).toContain('useSurveyModes().enabled')
    expect(readFileSync('components/onboarding/express/SnapshotScreen.tsx', 'utf8')).toContain("useSurveyModes().enabled.includes('chat')")
  })
})
