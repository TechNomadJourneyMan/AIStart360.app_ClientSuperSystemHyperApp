/**
 * lib/crm/card-client.ts — which client the «Карточка клиента» tab of /pulse shows (pure).
 */

export type CardPick<T> =
  | { kind: 'client'; client: T; fromBase: boolean }
  | { kind: 'deleted' }
  | { kind: 'loading' }
  | { kind: 'none' }

export interface CardPickInput<T extends { id: string }, B extends { id: string }> {
  /** The client the owner chose (or the first one the tab showed, pinned). */
  selectedId: string | null
  /** Today's queue and the risk list (fresh rows). */
  lists: readonly T[]
  /** The last row of the selected client seen in the lists. */
  lastKnown: T | null
  /** The whole base, once loaded (null while it is not). */
  base: readonly B[] | null
  /** Clients deleted from this screen. */
  deletedIds: ReadonlySet<string>
  /** A base row as a card row. */
  fromBaseRow: (row: B) => T
}

/**
 * The card shows ONLY the client the owner chose, looked up by id — never «the first one» as a
 * fallback. A logged touch takes a client off the queue (and a calmer one off the risk list); the
 * card used to jump to another person then, and «Написать» opened WhatsApp for — and logged a
 * message on — the wrong client. Now:
 *   in the lists                → that fresh row;
 *   left the lists, base read   → its row of the whole base (`fromBase`);
 *   left the lists, base not yet read → its last row seen in the lists, else «loading»;
 *   deleted (from this screen, or absent from the read base) → an empty state.
 * Only an explicit choice (or the page pinning the first client it showed) changes `selectedId`.
 */
export function pickCardClient<T extends { id: string }, B extends { id: string }>(input: CardPickInput<T, B>): CardPick<T> {
  const id = input.selectedId
  if (id == null) return { kind: 'none' }
  if (input.deletedIds.has(id)) return { kind: 'deleted' }
  const listed = input.lists.find((c) => c.id === id)
  if (listed) return { kind: 'client', client: listed, fromBase: false }
  if (input.base) {
    const row = input.base.find((c) => c.id === id)
    return row ? { kind: 'client', client: input.fromBaseRow(row), fromBase: true } : { kind: 'deleted' }
  }
  if (input.lastKnown && input.lastKnown.id === id) return { kind: 'client', client: input.lastKnown, fromBase: false }
  return { kind: 'loading' }
}
