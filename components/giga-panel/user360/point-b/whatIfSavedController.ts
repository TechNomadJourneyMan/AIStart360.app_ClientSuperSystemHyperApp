/**
 * components/giga-panel/user360/point-b/whatIfSavedController.ts — the brain of the expert's read-only list of
 * the client's saved «что если» (plan Ф4 Task 5), free of React and of the DOM so it can be tested with a fetch
 * double (same approach as finmodelPanelController.ts).
 *
 * Contract (plan Ф4 Task 3): GET /api/giga-admin/users/:id/point-b/whatif/saved (`clients.review` + the expert's
 * own clients) → { ok, data: Array<{ id, name, note, changes, summary, modelVersion, proposedAt, createdAt }> },
 * the same list the owner sees. Errors are `{ ok:false, error }`; the text of the server is shown as it is.
 * Parsing and wording are those of the owner's tab (components/point-b/whatIfModel).
 */
import { serverMessage } from '@/components/point-b/finmodelController'
import { describeChange, parseSavedList, savedDeltaLines, type SavedWhatIf } from '@/components/point-b/whatIfModel'

export interface WhatIfSavedSnapshot {
  phase: 'loading' | 'ready' | 'error'
  /** Text of the failure, as the server said it. */
  error: string | null
  items: SavedWhatIf[]
}

export const INITIAL_SAVED_SNAPSHOT: WhatIfSavedSnapshot = { phase: 'loading', error: null, items: [] }

const FALLBACK: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
}

export class WhatIfSavedController {
  private snap: WhatIfSavedSnapshot = INITIAL_SAVED_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly userId: string, private readonly fetchFn: typeof fetch) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): WhatIfSavedSnapshot => this.snap

  private set(patch: Partial<WhatIfSavedSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    const my = ++this.seq
    // A reload keeps the list on the screen; only the first load shows the skeleton.
    if (this.snap.phase !== 'ready') this.set({ phase: 'loading', error: null })
    try {
      const res = await this.fetchFn(`/api/giga-admin/users/${this.userId}/point-b/whatif/saved`, { credentials: 'include', cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as unknown
      if (my !== this.seq) return
      const items = res.ok ? parseSavedList(body) : null
      if (!items) {
        this.set({ phase: 'error', error: res.ok ? 'Не удалось прочитать сохранённые сценарии' : serverMessage(body, res.status, FALLBACK[res.status] ?? `Ошибка сервера (${res.status})`) })
        return
      }
      this.set({ phase: 'ready', error: null, items })
    } catch {
      if (my !== this.seq) return
      this.set({ phase: 'error', error: FALLBACK[0] })
    }
  }
}

/** One row as the expert reads it: the changes in words and the key deltas from the stored summary. */
export function savedRowView(s: SavedWhatIf): { changes: string[]; deltas: string[] } {
  return { changes: s.changes.map(describeChange), deltas: savedDeltaLines(s) }
}
