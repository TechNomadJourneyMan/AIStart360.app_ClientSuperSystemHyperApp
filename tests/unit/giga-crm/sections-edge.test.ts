import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blockedSectionFor, resetSectionCache } from '@/lib/platform/sections-edge'

const sections = [
  { key: 'point_b', paths: ['/point-b', '/client/point-b'], enabled: false, visibility: { audience: 'all' } },
  { key: 'gri', paths: ['/gri'], enabled: true, visibility: { audience: 'all' } },
  { key: 'content', paths: ['/client/content'], enabled: true, visibility: { audience: 'segments', segments: ['survey_completed'] } },
]
let facts: Record<string, unknown> = { status: 'approved', tier: 'free', vertical: 'generic', created_at: '2026-01-01', survey_steps: 3, gri_runs: 0, is_staff: false }
let factCalls = 0

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  resetSectionCache()
  factCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/rpc/user_segment_facts')) { factCalls++; return new Response(JSON.stringify(facts)) }
    return new Response(JSON.stringify(sections))
  }))
})

describe('blockedSectionFor', () => {
  it('blocks disabled sections on every matching path', async () => {
    expect(await blockedSectionFor('/point-b', 'u')).toBe('point_b')
    expect(await blockedSectionFor('/client/point-b/roadmap', 'u')).toBe('point_b')
  })

  it('leaves open sections and unrelated paths alone without loading user facts', async () => {
    expect(await blockedSectionFor('/gri', 'u')).toBeNull()
    expect(await blockedSectionFor('/point-bonus', 'u')).toBeNull()
    expect(await blockedSectionFor('/dashboard', 'u')).toBeNull()
    expect(factCalls).toBe(0)
  })

  it('applies audience rules using the user facts', async () => {
    expect(await blockedSectionFor('/client/content/intro', 'u')).toBe('content')
    facts = { ...facts, survey_steps: 12 }
    expect(await blockedSectionFor('/client/content/intro', 'u')).toBeNull()
  })
})
