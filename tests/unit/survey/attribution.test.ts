import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ANSWER_VIA, CLIENT_ANSWER_VIA, attributionColumns, authorFor, authorFromGoalActor, groupByAuthor, isAnswerVia, isMissingColumnError,
  isMissingViaColumnError, loadStaffRoles, stampRows, staffAuthorRole, unstampRows, writeWithAttribution,
} from '@/lib/survey/attribution'
import { memoryClient } from '../data-layer/memory-client'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const AT = new Date('2026-10-22T09:00:00Z')

describe('role mapping', () => {
  it('the owner is the user; a value accepted from a document is the AI', () => {
    expect(authorFor({ actorId: OWNER, ownerId: OWNER })).toEqual({ id: OWNER, role: 'user' })
    expect(authorFor({ actorId: null, ownerId: OWNER })).toEqual({ id: OWNER, role: 'user' })
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, origin: 'document' })).toEqual({ id: OWNER, role: 'ai' })
  })

  it('staff: expert / super_expert → expert, admin / super_admin / other staff → admin', () => {
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['expert'] })).toEqual({ id: EXPERT, role: 'expert' })
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['client', 'super_expert'] }).role).toBe('expert')
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['super_admin'] }).role).toBe('admin')
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['expert', 'admin'] }).role).toBe('admin')
    expect(staffAuthorRole('crm_manager')).toBe('admin')
    expect(staffAuthorRole('manager')).toBe('admin')
    // A staff save whose role could not be read: an expert (the common case).
    expect(staffAuthorRole()).toBe('expert')
    // An origin never turns a staff edit into the AI.
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['expert'], origin: 'document' }).role).toBe('expert')
  })

  it('W1 goal actors: owner → user, expert / admin as is', () => {
    expect(authorFromGoalActor({ id: OWNER, role: 'owner' })).toEqual({ id: OWNER, role: 'user' })
    expect(authorFromGoalActor({ id: EXPERT, role: 'expert' })).toEqual({ id: EXPERT, role: 'expert' })
    expect(authorFromGoalActor({ id: EXPERT, role: 'admin' })).toEqual({ id: EXPERT, role: 'admin' })
  })

  it('loadStaffRoles reads profiles.role and staff_roles.role; failures give no role', async () => {
    const m = memoryClient({ profiles: [{ id: EXPERT, role: 'expert' }], staff_roles: [{ user_id: EXPERT, role: 'super_expert' }] })
    expect(await loadStaffRoles(m.client, EXPERT)).toEqual(['expert', 'super_expert'])
    const broken = { from: () => { throw new Error('down') } } as unknown as SupabaseClient
    expect(await loadStaffRoles(broken, EXPERT)).toEqual([])
  })
})

describe('columns', () => {
  it('a non-uuid actor id is stored as null (the role still says who)', () => {
    expect(attributionColumns({ id: OWNER, role: 'user' }, AT)).toEqual({ updated_by: OWNER, updated_by_role: 'user', updated_at: AT.toISOString() })
    expect(attributionColumns({ id: 'giga:shared', role: 'admin' }, AT).updated_by).toBeNull()
    expect(attributionColumns({ id: null, role: 'system' }, AT).updated_by).toBeNull()
  })

  it('stamp / unstamp do not mutate the rows', () => {
    const rows = [{ question_key: 'a', answer: { value: 1 } }]
    const stamped = stampRows(rows, { id: OWNER, role: 'user' }, AT)
    expect(stamped[0]).toMatchObject({ question_key: 'a', updated_by: OWNER, updated_by_role: 'user' })
    expect(rows[0]).not.toHaveProperty('updated_by')
    expect(unstampRows(stamped)).toEqual(rows)
  })

  it('groupByAuthor keeps one write per author', () => {
    const g = groupByAuthor(['a', 'b', 'c'], (k) => (k === 'b' ? { id: OWNER, role: 'ai' } : { id: OWNER, role: 'user' }))
    expect(g.map((x) => [x.author.role, x.rows])).toEqual([['user', ['a', 'c']], ['ai', ['b']]])
  })
})

describe('writeWithAttribution', () => {
  it('writes the author columns', async () => {
    const write = vi.fn(async (_rows: Array<Record<string, unknown>>) => ({ error: null }))
    await writeWithAttribution([{ question_key: 'a' }], { id: OWNER, role: 'user' }, write, { at: AT })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0][0]).toEqual({ question_key: 'a', updated_by: OWNER, updated_by_role: 'user', updated_at: AT.toISOString() })
  })

  it.each([
    [{ code: 'PGRST204', message: "Could not find the 'updated_by' column of 'survey_answers' in the schema cache" }],
    [{ code: '42703', message: 'column "updated_by_role" of relation "survey_answers" does not exist' }],
  ])('before migration 131 (%o) retries once without the columns and warns', async (err) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const write = vi.fn()
      .mockResolvedValueOnce({ error: err })
      .mockResolvedValueOnce({ error: null })
    const res = await writeWithAttribution([{ question_key: 'a' }], { id: OWNER, role: 'user' }, write)
    expect(res.error).toBeNull()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toEqual([{ question_key: 'a' }])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('any other error is returned as is, without a retry', async () => {
    const write = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    const res = await writeWithAttribution([{ question_key: 'a' }], { id: OWNER, role: 'user' }, write)
    expect(res.error).toEqual({ code: '23505', message: 'duplicate' })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('isMissingColumnError', () => {
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ message: 'column "question_key" does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
  })
})

describe('the path of an answer (updated_via, migration 134)', () => {
  it('authorFor with a body path: owner → full / express / helper / document, staff → staff', () => {
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, via: 'full' })).toEqual({ id: OWNER, role: 'user', via: 'full' })
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, via: 'express' })).toEqual({ id: OWNER, role: 'user', via: 'express' })
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, via: null })).toEqual({ id: OWNER, role: 'user', via: 'full' })
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, via: 'full', origin: 'document' })).toEqual({ id: OWNER, role: 'ai', via: 'document' })
    expect(authorFor({ actorId: OWNER, ownerId: OWNER, via: 'full', origin: 'chat' })).toEqual({ id: OWNER, role: 'user', via: 'helper' })
    expect(authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['expert'], via: 'full' })).toEqual({ id: EXPERT, role: 'expert', via: 'staff' })
  })

  it('the column is written only when the author carries a path; null clears it', () => {
    expect(attributionColumns({ id: OWNER, role: 'user', via: 'express' }, AT)).toMatchObject({ updated_via: 'express' })
    expect(attributionColumns({ id: OWNER, role: 'user', via: null }, AT)).toMatchObject({ updated_via: null })
    expect(attributionColumns({ id: OWNER, role: 'user' }, AT)).not.toHaveProperty('updated_via')
    expect(unstampRows(stampRows([{ question_key: 'a' }], { id: OWNER, role: 'user', via: 'full' }, AT))).toEqual([{ question_key: 'a' }])
  })

  it('authors on different paths are written separately', () => {
    const groups = groupByAuthor(['a', 'b'], (k) => ({ id: OWNER, role: 'user' as const, via: k === 'a' ? 'full' as const : 'helper' as const }))
    expect(groups).toHaveLength(2)
  })

  it('the code paths match the migration lists', () => {
    expect([...ANSWER_VIA]).toEqual(['full', 'express', 'chat', 'helper', 'document', 'staff', 'system'])
    expect(CLIENT_ANSWER_VIA).not.toContain('chat')
    expect(CLIENT_ANSWER_VIA).not.toContain('staff')
    expect(isAnswerVia('chat')).toBe(true)
    expect(isAnswerVia('admin')).toBe(false)
  })

  it('before migration 134: retried without updated_via only, the author is kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const write = vi.fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'updated_via' column of 'survey_answers' in the schema cache" } })
      .mockResolvedValueOnce({ error: null })
    const res = await writeWithAttribution([{ question_key: 'a' }], { id: OWNER, role: 'user', via: 'full' }, write, { at: AT })
    expect(res.error).toBeNull()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toEqual([{ question_key: 'a', updated_by: OWNER, updated_by_role: 'user', updated_at: AT.toISOString() }])
    expect(isMissingViaColumnError({ code: '42703', message: 'column "updated_via" of relation "survey_answers" does not exist' })).toBe(true)
    expect(isMissingViaColumnError({ code: '42703', message: 'column "updated_by" does not exist' })).toBe(false)
    warn.mockRestore()
  })

  it('neither 131 nor 134: the second retry drops all author columns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const write = vi.fn()
      .mockResolvedValueOnce({ error: { code: '42703', message: 'column "updated_via" of relation "survey_answers" does not exist' } })
      .mockResolvedValueOnce({ error: { code: '42703', message: 'column "updated_by" of relation "survey_answers" does not exist' } })
      .mockResolvedValueOnce({ error: null })
    const res = await writeWithAttribution([{ question_key: 'a' }], { id: OWNER, role: 'user', via: 'full' }, write, { at: AT })
    expect(res.error).toBeNull()
    expect(write.mock.calls[2][0]).toEqual([{ question_key: 'a' }])
    warn.mockRestore()
  })
})
