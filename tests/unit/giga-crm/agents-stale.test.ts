/**
 * R-063 — «Агенты не запускаются»: the GIGA agents overview showed only «Последний запуск: 5 дн.
 * назад», the same grey line for an agent that runs weekly and for one whose 10-minute schedule
 * stopped days ago. An ENABLED agent that has not run within its expected interval (its cron's
 * longest gap, with half of it as slack; > 2 days when it has no schedule) is now marked
 * «не запускался N дн.» in a warning style.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentStaleness, cronGapMs } from '@/components/giga-panel/agents/model'

const NOW = new Date('2026-11-19T12:00:00Z')
const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const agent = (cron: string | null, lastRunAt: string | null, enabled = true) => ({ enabled, triggers: { cron }, stats: { lastRunAt } })

describe('cronGapMs — the longest gap between two firings', () => {
  it('every 10 minutes, daily, weekly; none for no or a bad schedule', () => {
    expect(cronGapMs('*/10 * * * *', NOW)).toBe(10 * MIN)
    expect(cronGapMs('0 4 * * *', NOW)).toBe(DAY)
    expect(cronGapMs('0 4 * * 1', NOW)).toBe(7 * DAY)
    expect(cronGapMs('17,47 * * * *', NOW)).toBe(30 * MIN)
    expect(cronGapMs(null, NOW)).toBeNull()
    expect(cronGapMs('nonsense', NOW)).toBeNull()
  })
})

describe('agentStaleness', () => {
  it('a 10-minute agent silent for 3 days: «не запускался 3 дн.», with the expected interval', () => {
    const s = agentStaleness(agent('*/10 * * * *', ago(3 * DAY + 2 * H)), NOW)
    expect(s).toMatchObject({ days: 3, label: 'не запускался 3 дн.' })
    expect(s?.title).toContain('каждые 10 мин')
  })

  it('within its interval (+ half of it as slack) is not stale', () => {
    expect(agentStaleness(agent('*/10 * * * *', ago(14 * MIN)), NOW)).toBeNull()
    expect(agentStaleness(agent('0 4 * * *', ago(30 * H)), NOW)).toBeNull()
    expect(agentStaleness(agent('0 4 * * 1', ago(6 * DAY)), NOW)).toBeNull()
  })

  it('a daily agent silent for 2 days is stale; under a day of silence is said in hours', () => {
    expect(agentStaleness(agent('0 4 * * *', ago(2 * DAY + H)), NOW)?.label).toBe('не запускался 2 дн.')
    expect(agentStaleness(agent('*/10 * * * *', ago(5 * H)), NOW)?.label).toBe('не запускался 5 ч')
  })

  it('no schedule (events or manual only): stale after 2 days', () => {
    expect(agentStaleness(agent(null, ago(47 * H)), NOW)).toBeNull()
    expect(agentStaleness(agent(null, ago(2 * DAY + MIN)), NOW)).toMatchObject({ days: 2, label: 'не запускался 2 дн.' })
  })

  it('a disabled agent, or one that never ran (no date to count from), is not marked', () => {
    expect(agentStaleness(agent('*/10 * * * *', ago(9 * DAY), false), NOW)).toBeNull()
    expect(agentStaleness(agent('*/10 * * * *', null), NOW)).toBeNull()
  })
})

describe('the overview card uses it', () => {
  it('AgentsOverviewPage renders the warning next to «Последний запуск»', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../components/giga-panel/agents/AgentsOverviewPage.tsx'), 'utf8')
    expect(src).toContain('agentStaleness(')
    expect(src).toMatch(/stale\s*&&[\s\S]{0,400}tone="amber"/)
  })
})
