/**
 * «Мой день»: раскладка задач по срокам, группировка кейсов и
 * детерминированная сводка «что изменилось» (без LLM).
 */
import { describe, expect, it } from 'vitest'
import { bucketTasks, groupCases, plural, startOfLocalDay, summarizeChanges } from '@/lib/admin/today'

describe('plural', () => {
  it('русские формы', () => {
    const f: [string, string, string] = ['ответ', 'ответа', 'ответов']
    expect(plural(1, f)).toBe('ответ')
    expect(plural(3, f)).toBe('ответа')
    expect(plural(5, f)).toBe('ответов')
    expect(plural(11, f)).toBe('ответов')
    expect(plural(21, f)).toBe('ответ')
  })
})

describe('bucketTasks', () => {
  // 2026-09-24 10:00 по Алматы (UTC+5) = 05:00 UTC.
  const now = Date.parse('2026-09-24T05:00:00Z')
  const tz = -300

  it('день начинается в полночь по времени сотрудника', () => {
    expect(new Date(startOfLocalDay(now, tz)).toISOString()).toBe('2026-09-23T19:00:00.000Z')
  })

  it('просрочено / сегодня / 7 дней / позже / без срока', () => {
    const t = (id: string, due: string | null, status = 'open') => ({ id, due_at: due, status })
    const b = bucketTasks([
      t('late', '2026-09-23T12:00:00Z'),
      t('earlier-today', '2026-09-24T02:00:00Z'), // 07:00 местного — уже прошло
      t('today', '2026-09-24T15:00:00Z'),          // 20:00 местного
      t('week', '2026-09-28T06:00:00Z'),
      t('later', '2026-10-20T06:00:00Z'),
      t('nodate', null),
      t('done', '2026-09-20T06:00:00Z', 'done'),
    ], now, tz)
    expect(b.overdue.map((x) => x.id)).toEqual(['late', 'earlier-today'])
    expect(b.today.map((x) => x.id)).toEqual(['today'])
    expect(b.week.map((x) => x.id)).toEqual(['week'])
    expect(b.later.map((x) => x.id)).toEqual(['later'])
    expect(b.noDate.map((x) => x.id)).toEqual(['nodate'])
  })
})

describe('groupCases', () => {
  it('по приоритету, внутри — самые старые первыми, пустые группы скрыты', () => {
    const g = groupCases([
      { id: 'a', priority: 'medium', created_at: '2026-09-02' },
      { id: 'b', priority: 'critical', created_at: '2026-09-03' },
      { id: 'c', priority: 'medium', created_at: '2026-09-01' },
    ])
    expect(g.map((x) => x.priority)).toEqual(['critical', 'medium'])
    expect(g[1].items.map((x) => x.id)).toEqual(['c', 'a'])
  })
})

describe('summarizeChanges', () => {
  const since = '2026-09-20T00:00:00Z'

  it('анкета, GRI с приростом, Точка А и документы', () => {
    const r = summarizeChanges({
      since,
      selfId: 'me',
      survey: [
        { question_key: 's1', created_at: '2026-09-21T00:00:00Z', changed_by: 'client' },
        { question_key: 's1', created_at: '2026-09-22T00:00:00Z', changed_by: 'client' },
        { question_key: 's2', created_at: '2026-09-22T00:00:00Z', changed_by: 'client' },
        { question_key: 's3', created_at: '2026-09-22T00:00:00Z', changed_by: null },
        { question_key: 's4', created_at: '2026-09-19T00:00:00Z', changed_by: 'client' }, // до просмотра
        { question_key: 's5', created_at: '2026-09-23T00:00:00Z', changed_by: 'me' },     // правил я сам
      ],
      gri: [
        { gri_index: 5.7, created_at: '2026-08-01T00:00:00Z' },
        { gri_index: 6.1, created_at: '2026-09-23T00:00:00Z' },
      ],
      diag: [
        { overall_score: 58, calculated_at: '2026-08-01T00:00:00Z' },
        { overall_score: 62.4, calculated_at: '2026-09-21T00:00:00Z' },
      ],
      docs: [{ file_name: 'pl.pdf', uploaded_at: '2026-09-22T00:00:00Z' }, { file_name: 'old.pdf', uploaded_at: '2026-09-01T00:00:00Z' }],
    })
    expect(r.lines).toEqual([
      'Анкета: 3 ответа изменены',
      'GRI: новый замер 6.1 (+0.4)',
      'Точка А: пересчитана, 62 (+4)',
      'Документы: 1 новый',
    ])
    expect(r.changedAt).toBe('2026-09-23T00:00:00Z')
    expect(r.counts).toEqual({ survey: 3, gri: 1, pointA: 1, documents: 1 })
  })

  it('первый замер — без прироста; несколько замеров — с числом', () => {
    expect(summarizeChanges({ since, survey: [], diag: [], docs: [], gri: [{ gri_index: 4, created_at: '2026-09-21T00:00:00Z' }] }).lines)
      .toEqual(['GRI: новый замер 4.0'])
    expect(summarizeChanges({
      since, survey: [], diag: [], docs: [],
      gri: [
        { gri_index: 7, created_at: '2026-09-01T00:00:00Z' },
        { gri_index: 6, created_at: '2026-09-21T00:00:00Z' },
        { gri_index: 6.5, created_at: '2026-09-22T00:00:00Z' },
      ],
    }).lines).toEqual(['GRI: 2 новых замера, последний 6.5 (−0.5)'])
  })

  it('ничего нового — пустая сводка', () => {
    const r = summarizeChanges({ since, survey: [], gri: [], diag: [], docs: [] })
    expect(r.lines).toEqual([])
    expect(r.changedAt).toBeNull()
  })

  it('первая Точка А — «рассчитана»', () => {
    expect(summarizeChanges({ since, survey: [], gri: [], docs: [], diag: [{ overall_score: 40, calculated_at: '2026-09-21T00:00:00Z' }] }).lines)
      .toEqual(['Точка А: рассчитана, 40'])
  })
})
