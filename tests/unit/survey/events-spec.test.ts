/**
 * Survey Ф5 — every event of spec §15 is in the vocabulary with the right
 * «client» flag and is written by at least one place in the code (a browser
 * `track(...)` for client events, the server for the rest).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EVENTS } from '@/lib/events/registry'

const SPEC_15: Record<string, boolean> = {
  SURVEY_MODE_CHOSEN: true,
  SURVEY_EXPRESS_STARTED: true,
  SURVEY_EXPRESS_COMPLETED: false,
  SURVEY_SNAPSHOT_VIEWED: true,
  SURVEY_BLOCK_OPENED: true,
  SURVEY_BLOCK_COMPLETED: false,
  SURVEY_ANSWERS_VIEWED: true,
  SURVEY_HELPER_OPENED: true,
  SURVEY_CHAT_PROPOSAL: false,
  SURVEY_CHAT_GUARD_BLOCKED: false,
  SURVEY_CHAT_ESCALATED: false,
  SURVEY_CALC_EXPANDED: true,
}

const ROOT = process.cwd()
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const code = ['app', 'components', 'lib', 'hooks']
  .flatMap((d) => sources(join(ROOT, d)))
  .filter((p) => !p.endsWith(join('lib', 'events', 'registry.ts')) && !p.includes(`${join('app', 'dev')}`))
  .map((p) => readFileSync(p, 'utf8'))

describe('spec §15 events', () => {
  it.each(Object.entries(SPEC_15))('%s is in the vocabulary with client=%s', (name, client) => {
    const def = (EVENTS as Record<string, { client: boolean; type: string }>)[name]
    expect(def, name).toBeTruthy()
    expect(def.client).toBe(client)
    expect(def.type).toBe('questionnaire')
  })

  it.each(Object.keys(SPEC_15))('%s is written somewhere in the code', (name) => {
    // A browser track('NAME' …) / a server trackEvent({ name: 'NAME' … }) / a typed dependency call.
    expect(code.some((src) => src.includes(`'${name}'`)), name).toBe(true)
  })

  it('the existing QUESTIONNAIRE_* events stay (§15: «не меняются»)', () => {
    for (const n of ['QUESTIONNAIRE_STARTED', 'QUESTIONNAIRE_STEP_COMPLETED', 'QUESTIONNAIRE_COMPLETED']) expect(n in EVENTS).toBe(true)
  })
})
