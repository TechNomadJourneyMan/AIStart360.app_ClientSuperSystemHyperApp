/**
 * lib/crm/card-client.ts — the «Карточка» tab keeps the client the owner chose (review, medium):
 * after a logged touch the chosen client left the queue / risk lists and the card silently fell
 * back to the FIRST client — «Написать» then opened WhatsApp for, and logged a message on, another
 * person. The card now keeps the chosen client by id; a deleted one is an empty state.
 */
import { describe, expect, it } from 'vitest'
import { pickCardClient, type CardPickInput } from '@/lib/crm/card-client'

type Row = { id: string; name: string; src: string }
const row = (id: string, src = 'list'): Row => ({ id, name: `Клиент ${id}`, src })
const input = (over: Partial<CardPickInput<Row, { id: string; name: string }>> = {}): CardPickInput<Row, { id: string; name: string }> => ({
  selectedId: 'b',
  lists: [row('a'), row('b'), row('c')],
  lastKnown: null,
  base: null,
  deletedIds: new Set(),
  fromBaseRow: (r) => ({ id: r.id, name: r.name, src: 'base' }),
  ...over,
})

describe('pickCardClient', () => {
  it('the chosen client, fresh from the lists', () => {
    expect(pickCardClient(input())).toEqual({ kind: 'client', client: row('b'), fromBase: false })
  })

  it('the chosen client left the lists (a logged touch): never another person — its last row until the base is read', () => {
    const lists = [row('a'), row('c')]
    const pick = pickCardClient(input({ lists, lastKnown: row('b', 'last') }))
    expect(pick).toEqual({ kind: 'client', client: row('b', 'last'), fromBase: false })
    // nothing known yet: loading, not the first client
    expect(pickCardClient(input({ lists, lastKnown: row('x', 'last') }))).toEqual({ kind: 'loading' })
  })

  it('…then the row of the whole base', () => {
    const pick = pickCardClient(input({ lists: [row('a')], lastKnown: row('b', 'last'), base: [{ id: 'a', name: 'A' }, { id: 'b', name: 'Б' }] }))
    expect(pick).toEqual({ kind: 'client', client: { id: 'b', name: 'Б', src: 'base' }, fromBase: true })
  })

  it('a deleted client is an empty state, never another person', () => {
    expect(pickCardClient(input({ lists: [row('a')], lastKnown: row('b'), base: [{ id: 'a', name: 'A' }] }))).toEqual({ kind: 'deleted' })
    expect(pickCardClient(input({ lists: [row('a')], lastKnown: row('b'), deletedIds: new Set(['b']) }))).toEqual({ kind: 'deleted' })
    // deleted from this screen while the queue still has the old row
    expect(pickCardClient(input({ deletedIds: new Set(['b']) }))).toEqual({ kind: 'deleted' })
  })

  it('nothing chosen: nothing to show (the page pins the first client it shows as the choice)', () => {
    expect(pickCardClient(input({ selectedId: null }))).toEqual({ kind: 'none' })
  })
})
