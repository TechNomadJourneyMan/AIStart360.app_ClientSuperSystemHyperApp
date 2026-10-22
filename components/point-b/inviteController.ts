/**
 * components/point-b/inviteController.ts — the invite cards of the «Обзор» (plan Ф6a Task 7, spec §12.1), free of
 * React and of the DOM so it can be tested with a fetch double.
 *
 * Contract (plan Ф6a Task 6): `PATCH /api/v1/point-b/invites/:id` with `{ action: 'seen' | 'dismiss' | 'snooze' | 'acted',
 * days?: 3 | 7 | 30 }` → `{ ok }` / `{ ok: false, error }` (403 while impersonating, 404 for a foreign invite).
 *
 *   - a card on the screen is marked `seen` once;
 *   - «Закрыть» (dismiss — the rule pauses for 14 days), «Позже» (snooze 3 / 7 / 30 days) and «Открыть» (acted) take the
 *     card away at once; if the server refuses, the card comes back with the server's text;
 *   - a card the user took away does not come back when the page state reloads.
 */
import type { InviteView } from '@/lib/point-b/invites/types'
import { MAX_INVITE_CARDS } from './recsModel'

export const INVITE_SNOOZE_DAYS = [3, 7, 30] as const
export type InviteSnoozeDays = (typeof INVITE_SNOOZE_DAYS)[number]
export type InviteAction = 'seen' | 'dismiss' | 'snooze' | 'acted'

export interface InviteSnapshot {
  invites: InviteView[]
  /** Id of the card whose action is being saved. */
  busy: string | null
  error: string | null
}

const FALLBACK: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'В режиме просмотра от имени клиента карточки не меняются',
  404: 'Подсказка уже неактуальна',
}

export class InviteController {
  private snap: InviteSnapshot = { invites: [], busy: null, error: null }
  private listeners = new Set<() => void>()
  private readonly gone = new Set<string>()
  private readonly seenSent = new Set<string>()
  private source: InviteView[] = []

  constructor(private readonly fetchFn: typeof fetch, invites: InviteView[] = []) {
    this.setInvites(invites)
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): InviteSnapshot => this.snap

  private set(patch: Partial<InviteSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  private visible(): InviteView[] {
    return this.source.filter((i) => !this.gone.has(i.id)).slice(0, MAX_INVITE_CARDS)
  }

  /** The page state (re)loaded: the cards the user already took away stay away. */
  setInvites(list: InviteView[]): void {
    this.source = [...list]
    this.set({ invites: this.visible() })
  }

  private async patch(id: string, body: { action: InviteAction; days?: InviteSnoozeDays }): Promise<{ ok: boolean; message: string | null }> {
    try {
      const res = await this.fetchFn(`/api/v1/point-b/invites/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null
      if (res.ok && data?.ok !== false) return { ok: true, message: null }
      const text = typeof data?.error === 'string' && /[а-яё]/i.test(data.error) ? data.error : null
      return { ok: false, message: text ?? FALLBACK[res.status] ?? `Не удалось сохранить (${res.status})` }
    } catch {
      return { ok: false, message: FALLBACK[0] }
    }
  }

  /** The cards now on the screen are marked as seen, once each. A failure is silent. */
  async markSeen(ids: string[] = this.snap.invites.map((i) => i.id)): Promise<void> {
    const fresh = ids.filter((id) => !this.seenSent.has(id) && !this.gone.has(id))
    fresh.forEach((id) => this.seenSent.add(id))
    await Promise.all(fresh.map((id) => this.patch(id, { action: 'seen' })))
  }

  private async takeAway(id: string, body: { action: InviteAction; days?: InviteSnoozeDays }): Promise<boolean> {
    if (this.snap.busy || this.gone.has(id) || !this.source.some((i) => i.id === id)) return false
    this.gone.add(id)
    this.set({ invites: this.visible(), busy: id, error: null })
    const r = await this.patch(id, body)
    if (!r.ok) {
      this.gone.delete(id)
      this.set({ invites: this.visible(), busy: null, error: r.message })
      return false
    }
    this.set({ busy: null })
    return true
  }

  dismiss(id: string): Promise<boolean> { return this.takeAway(id, { action: 'dismiss' }) }

  snooze(id: string, days: InviteSnoozeDays): Promise<boolean> {
    if (!(INVITE_SNOOZE_DAYS as readonly number[]).includes(days)) return Promise.resolve(false)
    return this.takeAway(id, { action: 'snooze', days })
  }

  /** «Открыть»: the user acted on the card (the navigation happens anyway). */
  act(id: string): Promise<boolean> { return this.takeAway(id, { action: 'acted' }) }

  clearError(): void { this.set({ error: null }) }
}

/** In the dev preview nothing leaves the page: every write «succeeds» in memory. */
export const previewFetch: typeof fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
