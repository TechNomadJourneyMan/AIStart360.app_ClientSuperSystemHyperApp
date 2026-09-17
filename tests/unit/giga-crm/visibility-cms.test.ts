import { describe, expect, it } from 'vitest'
import { describeRule, isVisible, userSegments, type UserFacts } from '@/lib/platform/visibility'
import { blockSchema, pageSaveSchema, parseInline, safeUrl, slugify, videoEmbed } from '@/lib/cms/blocks'
import { pathIsHidden } from '@/lib/platform/sections'

const now = Date.parse('2026-09-17T00:00:00Z')
const base: UserFacts = { role: 'client', status: 'approved', tier: 'free', vertical: 'generic', created_at: '2026-01-01T00:00:00Z', survey_steps: 12, gri_runs: 0, is_staff: false }

describe('visibility rules', () => {
  it('computes segments from facts', () => {
    const s = userSegments({ ...base, created_at: '2026-09-10T00:00:00Z' }, now)
    expect([...s].sort()).toEqual(['approved', 'gri_not_completed', 'new_users', 'survey_completed', 'tier_free', 'vertical_generic'].sort())
  })

  it('all / staff_only / segments any+all', () => {
    expect(isVisible({ audience: 'all' }, null)).toBe(true)
    expect(isVisible(null, base)).toBe(true)
    expect(isVisible({ audience: 'staff_only' }, base)).toBe(false)
    expect(isVisible({ audience: 'staff_only' }, { ...base, is_staff: true })).toBe(true)
    expect(isVisible({ audience: 'segments', segments: ['gri_completed'] }, base, now)).toBe(false)
    expect(isVisible({ audience: 'segments', segments: ['gri_completed', 'survey_completed'] }, base, now)).toBe(true)
    expect(isVisible({ audience: 'segments', segments: ['gri_completed', 'survey_completed'], match: 'all' }, base, now)).toBe(false)
    expect(isVisible({ audience: 'segments', segments: [] }, base, now)).toBe(false)
    expect(isVisible({ audience: 'segments', segments: ['survey_completed'] }, null, now)).toBe(false)
  })

  it('fails closed on broken rules', () => {
    expect(isVisible({ audience: 'everyone' }, base)).toBe(false)
    expect(isVisible({ audience: 'segments', segments: ['hackers'] }, base)).toBe(false)
    expect(describeRule({ audience: 'nope' })).toMatch(/Некорректное/)
    expect(describeRule({ audience: 'segments', segments: ['tier_pro'] })).toContain('Тариф Pro')
  })

  it('hidden section paths match whole segments only', () => {
    expect(pathIsHidden('/point-b', ['/point-b'])).toBe(true)
    expect(pathIsHidden('/point-b/x', ['/point-b'])).toBe(true)
    expect(pathIsHidden('/point-bonus', ['/point-b'])).toBe(false)
  })
})

describe('cms blocks', () => {
  it('only https or site-relative urls', () => {
    expect(safeUrl('https://ex.com/a')).toBe('https://ex.com/a')
    expect(safeUrl('/client/home')).toBe('/client/home')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('http://ex.com')).toBeNull()
    expect(safeUrl('//evil.com')).toBeNull()
    expect(safeUrl('data:text/html,x')).toBeNull()
  })

  it('embeds known video hosts only', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' })
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ')?.kind).toBe('iframe')
    expect(videoEmbed('https://vimeo.com/123456789')?.src).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbed('https://abc.supabase.co/storage/v1/object/public/cms-media/v.mp4')?.kind).toBe('file')
    expect(videoEmbed('https://cdn.example.com/v.mp4')).toBeNull()
    expect(videoEmbed('https://evil.example.com/page')).toBeNull()
  })

  it('inline formatting never produces unsafe links', () => {
    expect(parseInline('a **b** [c](https://x.io) [d](javascript:alert(1))')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'bold', v: 'b' }, { t: 'text', v: ' ' }, { t: 'link', v: 'c', href: 'https://x.io/' },
      { t: 'text', v: ' ' }, { t: 'text', v: '[d](javascript:alert(1)' }, { t: 'text', v: ')' },
    ])
  })

  it('validates block content per type', () => {
    expect(blockSchema.safeParse({ type: 'heading', content: { text: 'Hi', level: 2 } }).success).toBe(true)
    expect(blockSchema.safeParse({ type: 'heading', content: { text: '' } }).success).toBe(false)
    expect(blockSchema.safeParse({ type: 'cta', content: { label: 'Go', href: 'javascript:x' } }).success).toBe(false)
    expect(blockSchema.safeParse({ type: 'image', content: { url: 'https://x.io/a.png' } }).success).toBe(true)
    expect(blockSchema.safeParse({ type: 'script', content: {} }).success).toBe(false)
  })

  it('validates a page save', () => {
    const ok = pageSaveSchema.safeParse({
      page: { slug: 'Start-Here', title: 'Старт', visibility: { audience: 'all' }, show_in_nav: true, sort_order: 1 },
      blocks: [{ type: 'text', content: { text: 'Привет' } }],
      expectedVersion: 1,
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.page.slug).toBe('start-here')
    expect(pageSaveSchema.safeParse({ page: { slug: 'bad slug', title: 'x', visibility: { audience: 'all' }, show_in_nav: false, sort_order: 0 }, blocks: [], expectedVersion: 1 }).success).toBe(false)
  })

  it('slugifies cyrillic titles', () => {
    expect(slugify('Как пройти GRI — пошагово')).toBe('kak-proyti-gri-poshagovo')
    expect(slugify('!!!')).toBe('page')
  })
})
