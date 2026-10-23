/**
 * Survey Ф5 — the funnel of the questionnaire modes (spec §15, §16 Ф5):
 * «выбор режима → экспресс → снимок → блок → полная анкета отправлена» from
 * user_events; PO §18.3 item 1 — only the full questionnaire is «отправлена».
 */
import { describe, expect, it } from 'vitest'
import { computeModeFunnel, median, scopeFunnelLists, type FunnelEvent } from '@/lib/survey/mode-funnel'

const SINCE = new Date('2026-10-01T00:00:00Z')
const UNTIL = new Date('2026-10-31T00:00:00Z')
let n = 0
const ev = (user: string, name: string, at: string, metadata: Record<string, unknown> = {}, source = 'web'): FunnelEvent =>
  ({ id: ++n, user_id: user, event_name: name, created_at: `2026-10-${at}Z`, metadata, source })

// A: express path to the end of the funnel; B: express, then stuck; C: picked the full
// questionnaire and submitted; D: chose the chat, nothing else; E: chose before the period;
// F: submitted the full questionnaire BEFORE choosing; G: the choice was made «от имени».
const events: FunnelEvent[] = [
  ev('A', 'SURVEY_MODE_CHOSEN', '02T09:00:00', { mode: 'express', previous: null, from: 'chooser' }),
  ev('A', 'SURVEY_EXPRESS_STARTED', '02T09:01:00'),
  ev('A', 'SURVEY_EXPRESS_COMPLETED', '02T09:09:00', { answered: 26, unknown: 1, skipped: 0, minutes: 8 }),
  ev('A', 'SURVEY_SNAPSHOT_VIEWED', '02T09:10:00', { point_a_ready: true }),
  ev('A', 'SURVEY_BLOCK_OPENED', '04T09:00:00', { block: 'b10' }),
  ev('A', 'SURVEY_BLOCK_COMPLETED', '04T09:20:00', { block: 'b10' }),
  ev('A', 'SURVEY_MODE_CHOSEN', '05T09:00:00', { mode: 'full', previous: 'express', from: 'switch' }),
  ev('B', 'SURVEY_MODE_CHOSEN', '03T09:00:00', { mode: 'express', from: 'chooser' }),
  ev('B', 'SURVEY_EXPRESS_STARTED', '03T09:01:00'),
  ev('B', 'SURVEY_EXPRESS_COMPLETED', '03T09:13:00', { answered: 20, unknown: 3, skipped: 6, minutes: 12 }),
  ev('B', 'SURVEY_SNAPSHOT_VIEWED', '03T09:14:00'),
  ev('B', 'SURVEY_BLOCK_OPENED', '20T09:00:00', { block: 'b11' }), // later than 7 days
  ev('C', 'SURVEY_MODE_CHOSEN', '05T09:00:00', { mode: 'full', from: 'chooser' }),
  ev('D', 'SURVEY_MODE_CHOSEN', '06T09:00:00', { mode: 'chat', from: 'chooser' }),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:05:00', { key: 's1_x', outcome: 'shown' }, 'server'),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:05:00', { key: 's1_x', outcome: 'shown' }, 'server'),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:06:00', { key: 's1_x', outcome: 'applied' }, 'server'),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:07:00', { key: 's1_y', outcome: 'applied' }, 'server'),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:08:00', { key: 's1_z', outcome: 'applied' }, 'server'),
  ev('D', 'SURVEY_CHAT_PROPOSAL', '06T09:09:00', { key: 's1_w', outcome: 'edited' }, 'server'),
  ev('D', 'SURVEY_CHAT_GUARD_BLOCKED', '06T09:10:00', { key: 's1_x' }, 'server'),
  ev('D', 'SURVEY_CHAT_ESCALATED', '06T09:11:00', { key: 's1_x' }, 'server'),
  ev('D', 'SURVEY_HELPER_OPENED', '06T09:12:00', { key: 's1_x', action: 'open' }),
  { id: 'old', user_id: 'E', event_name: 'SURVEY_MODE_CHOSEN', created_at: '2026-09-20T09:00:00Z', metadata: { mode: 'express' }, source: 'web' },
  ev('E', 'SURVEY_MODE_CHOSEN', '07T09:00:00', { mode: 'full', previous: 'express', from: 'switch' }),
  ev('F', 'SURVEY_MODE_CHOSEN', '08T09:00:00', { mode: 'express', from: 'chooser' }),
  ev('G', 'SURVEY_MODE_CHOSEN', '09T09:00:00', { mode: 'chat', from: 'chooser' }, 'impersonation'),
]
const submissions = new Map([['A', '2026-10-10T09:00:00Z'], ['C', '2026-10-15T09:00:00Z'], ['F', '2026-09-01T09:00:00Z']])
const f = computeModeFunnel({ events: [...events, ...events.slice(0, 3)], submissions, since: SINCE, until: UNTIL, now: new Date('2026-10-23T09:13:00Z') })

describe('computeModeFunnel', () => {
  it('cohort = first choice in the period; staff-made choices and pre-mode submissions are out', () => {
    expect(f.cohort).toBe(4) // A, B, C, D
  })

  it('the seven steps with shares of the cohort and of the previous step (not strict)', () => {
    expect(f.steps.map((s) => [s.key, s.users])).toEqual([
      ['chosen', 4], ['express_started', 2], ['express_completed', 2], ['snapshot', 2], ['block_opened', 2], ['block_completed', 1], ['full_submitted', 2],
    ])
    expect(f.steps[0]).toMatchObject({ ofCohort: 100, ofPrevious: null })
    expect(f.steps[5]).toMatchObject({ ofCohort: 25, ofPrevious: 50 })
    // C chose «Полная» and submitted: counted though it never touched the express.
    expect(f.steps[6]).toMatchObject({ ofCohort: 50, ofPrevious: null })
  })

  it('modes: first and last choice, switches', () => {
    expect(f.byFirstMode).toEqual({ full: 1, express: 2, chat: 1 })
    expect(f.byLastMode).toEqual({ full: 2, express: 1, chat: 1 })
    expect(f.switched).toBe(1)
  })

  it('express: median minutes, a block within 7 days', () => {
    expect(f.express).toEqual({ medianMinutes: 10, completed: 2, blockWithin7d: 1, blockWithin7dShare: 50 })
  })

  it('chat cards: events read twice (two ranges) count once; accepted without edit = applied / decided', () => {
    expect(f.chat).toEqual({ shown: 2, applied: 3, edited: 1, rejected: 0, acceptedWithoutEdit: 75, guardBlocked: 1, escalated: 1, helperOpened: 1 })
  })

  it('stuck on the express (all time) and the cohort without a submission', () => {
    expect(f.stuck).toEqual([{ userId: 'B', expressCompletedAt: '2026-10-03T09:13:00Z', days: 20 }])
    expect(f.pending.map((p) => [p.userId, p.mode])).toEqual([['D', 'chat']])
  })

  it('without the completions RPC the QUESTIONNAIRE_COMPLETED event decides', () => {
    const g = computeModeFunnel({
      events: [ev('X', 'SURVEY_MODE_CHOSEN', '02T09:00:00', { mode: 'full' }), ev('X', 'QUESTIONNAIRE_COMPLETED', '03T09:00:00', {}, 'server')],
      submissions: null, since: SINCE, until: UNTIL,
    })
    expect(g.steps.at(-1)).toMatchObject({ users: 1, ofCohort: 100 })
  })

  it('an empty period → zeros and nulls, no division by zero', () => {
    const g = computeModeFunnel({ events: [], submissions: new Map(), since: SINCE, until: UNTIL })
    expect(g.cohort).toBe(0)
    expect(g.steps.every((s) => s.users === 0 && s.ofCohort === null)).toBe(true)
    expect(g.chat.acceptedWithoutEdit).toBeNull()
    expect(g.express.medianMinutes).toBeNull()
  })
})

describe('helpers', () => {
  it('median', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('a scoped expert sees only his clients in the lists; aggregates stay', () => {
    const scoped = scopeFunnelLists(f, ['D'])
    expect(scoped.stuck).toEqual([])
    expect(scoped.pending.map((p) => p.userId)).toEqual(['D'])
    expect(scoped.cohort).toBe(4)
    expect(scopeFunnelLists(f, null).stuck).toHaveLength(1)
    expect(scopeFunnelLists(f, null, 0).stuck).toHaveLength(0)
  })
})
