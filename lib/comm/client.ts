/**
 * lib/comm/client.ts — the user's own view of his conversation (cabinet
 * «Сообщения», /api/v1/comm/*). Pure shaping, no IO.
 *
 * One bubble per send (group_id) with the channels it reached; staff-only
 * fields (errors, metadata, masked copies, assignee, counters) never leave
 * the server. The user sees his own text exactly as he wrote it. A send that
 * reached him on no channel at all is not shown.
 */
import type { CommChannel, CommMessageRow } from './types'

export interface ClientMessage {
  id: string
  direction: 'in' | 'out'
  authorKind: CommMessageRow['author_kind']
  authorName: string | null
  body: string
  subject: string | null
  channels: CommChannel[]
  createdAt: string
}

const REACHED = new Set(['sent', 'delivered', 'queued', 'sending'])

export function clientFeed(rows: CommMessageRow[]): ClientMessage[] {
  const groups = new Map<string, CommMessageRow[]>()
  for (const r of rows) {
    const g = groups.get(r.group_id)
    if (g) g.push(r)
    else groups.set(r.group_id, [r])
  }
  const out: ClientMessage[] = []
  for (const g of Array.from(groups.values())) {
    const first = g[0]
    const reached = first.direction === 'in' ? g : g.filter((r) => REACHED.has(r.status))
    if (!reached.length) continue
    out.push({
      id: first.id,
      direction: first.direction,
      authorKind: first.author_kind,
      authorName: first.direction === 'out' ? (first.author_kind === 'bot' ? 'Бот AIStart360' : first.author_name) : null,
      body: first.body,
      subject: first.subject,
      channels: reached.map((r) => r.channel),
      createdAt: first.created_at,
    })
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
