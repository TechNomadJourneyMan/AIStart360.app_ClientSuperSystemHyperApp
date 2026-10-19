/**
 * components/point-b/whatIfController.ts — the brain of the «Что если» tab (plan Ф4 Task 4), free of
 * React and of the DOM so it can be tested with a fetch double and fake timers (same approach as
 * finmodelController.ts). `useWhatIf` binds it to the tab.
 *
 * Contract (plan Ф4 Task 3), all under /api/v1/point-b/whatif:
 *   POST {changes}                     → { ok, data: WhatIfResult }   400 { error, field: 'changes[1].pp' } · 402 · 429
 *   GET  /saved                        → { ok, data: SavedWhatIf[] }
 *   POST /saved {name, note?, changes} → saved on the server with its own summary (the client sends none)
 *                                        400 { error, field: 'name'|'note'|'changes[i].x' } · 403 «от имени» · 409 { code: 'limit' }
 *   DELETE /saved/:id                  → 404 for someone else's
 *   POST /saved/:id/propose {comment?} → 409 { code: 'already_proposed' } · 400 { field: 'comment' } · 403
 *
 * Behaviour: an edit schedules ONE request after 400 ms of quiet; a newer edit aborts the request in flight and an
 * answer of an outdated request is ignored. Nothing is sent for invalid input (the field shows why). The tab never
 * writes to the plan: «Предложить эксперту» only sends a message.
 */
import { isUpgradeRequired } from './pointBAccess'
import { serverMessage } from './finmodelController'
import type { DataLevel } from '@/lib/point-b/model/types'
import type { WhatIfChange, WhatIfKind, WhatIfResult } from '@/lib/point-b/model/whatif'
import {
  DEBOUNCE_MS, NAME_MAX, NOTE_MAX, buildChanges, defaultCard, defaultDraft, draftFromChanges, enabledKinds,
  hasErrors, mapServerField, parseSavedList, parseWhatIfResponse,
  type CardErrors, type Draft, type SavedWhatIf,
} from './whatIfModel'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export type CalcStatus = 'idle' | 'waiting' | 'loading' | 'ready' | 'invalid' | 'error'
export type Applicable = WhatIfResult['applicable']

export interface SaveErrors { name?: string; note?: string; general?: string }

export interface WhatIfSnapshot {
  /** 'locked' = the tariff gate (402): the tab draws the Pro placeholder. */
  access: 'ok' | 'locked'
  draft: Draft
  cardErrors: CardErrors
  calc: CalcStatus
  /** A failure that is not about one field (network, 429, 500). */
  calcError: string | null
  /** The last result of a non-empty request; cleared by a reset. */
  result: WhatIfResult | null
  /** What the server said about the data: from the first probe and from every result. */
  level: DataLevel | null
  applicable: Applicable | null
  saved: SavedWhatIf[]
  savedPhase: 'loading' | 'ready' | 'error'
  savedError: string | null
  name: string
  note: string
  saving: boolean
  saveErrors: SaveErrors
  /** «Сохранено», «Загружено в калькуляторы»… */
  notice: string | null
  /** Saving and proposing are refused «от имени»: the buttons are hidden once the server says so. */
  readOnly: boolean
  /** The open «Предложить эксперту» form. */
  proposal: { id: string; comment: string } | null
  proposing: string | null
  /** Per saved scenario: failures of delete / propose. */
  rowErrors: Record<string, string>
}

export const INITIAL_WHATIF_SNAPSHOT: WhatIfSnapshot = {
  access: 'ok', draft: defaultDraft(), cardErrors: {}, calc: 'idle', calcError: null, result: null, level: null, applicable: null,
  saved: [], savedPhase: 'loading', savedError: null, name: '', note: '', saving: false, saveErrors: {}, notice: null, readOnly: false,
  proposal: null, proposing: null, rowErrors: {},
}

const STATUS_TEXT: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'Нет доступа к этому разделу',
  429: 'Слишком много расчётов подряд. Подождите немного и повторите.',
}
export const READ_ONLY_TEXT = 'В режиме просмотра от имени пользователя сохранять и предлагать нельзя'
const LIMIT_TEXT = 'Можно хранить не более 20 сценариев — удалите ненужный и сохраните снова'

export interface WhatIfControllerOptions {
  /** Preloaded changes (the dev preview): switched on and calculated at once. */
  initialChanges?: WhatIfChange[]
  /** Clock for the local «предложено» mark. */
  now?: () => string
  debounceMs?: number
}

export class WhatIfController {
  private snap: WhatIfSnapshot = INITIAL_WHATIF_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: AbortController | null = null
  private disposed = false

  constructor(private readonly fetchFn: typeof fetch, private readonly options: WhatIfControllerOptions = {}) {
    if (options.initialChanges?.length) this.snap = { ...this.snap, draft: draftFromChanges(options.initialChanges) }
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): WhatIfSnapshot => this.snap

  private set(patch: Partial<WhatIfSnapshot>): void {
    if (this.disposed) return
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Stops the timer and the request in flight (the tab was closed). */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.inflight?.abort()
    this.inflight = null
    this.seq++
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
  }

  // ── Start ─────────────────────────────────────────────────────────────

  /** Loads the saved list and asks the server what the data allows (an empty set of changes). */
  async init(): Promise<void> {
    // React may mount, unmount and mount again (strict mode): a stopped controller starts over.
    this.disposed = false
    const saved = this.loadSaved()
    if (this.options.initialChanges?.length) await this.calculate()
    else await this.probe()
    await saved
  }

  /** An empty calculation: which calculators the data allows and at what level. Nothing is shown from it but the greying. */
  private async probe(): Promise<void> {
    const my = ++this.seq
    try {
      const res = await this.fetchFn('/api/v1/point-b/whatif', this.post({ changes: [] }))
      const body = (await res.json().catch(() => null)) as unknown
      if (my !== this.seq) return
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ access: 'locked' }); return }
      const parsed = res.ok ? parseWhatIfResponse(body) : null
      // A refusal of the probe is not an error of the tab: the calculators stay open, the server validates each request.
      if (parsed) this.set({ level: parsed.level, applicable: parsed.applicable })
    } catch {
      /* silence: the first real calculation reports a failure */
    }
  }

  private post(body: unknown, signal?: AbortSignal): RequestInit {
    return { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
  }

  // ── The calculators ───────────────────────────────────────────────────

  private canEnable(kind: WhatIfKind): boolean {
    return this.snap.applicable?.[kind]?.ok !== false
  }

  setEnabled(kind: WhatIfKind, enabled: boolean): void {
    if (enabled && !this.canEnable(kind)) return
    const card = this.snap.draft[kind]
    if (card.enabled === enabled) return
    const { [kind]: _drop, ...rest } = this.snap.cardErrors
    void _drop
    this.set({ draft: { ...this.snap.draft, [kind]: { ...card, enabled } }, cardErrors: rest, notice: null })
    this.schedule()
  }

  setParam(kind: WhatIfKind, key: string, text: string): void {
    const card = this.snap.draft[kind]
    const errs = this.snap.cardErrors[kind]
    let cardErrors = this.snap.cardErrors
    if (errs) {
      const { [key]: _p, ...params } = errs.params
      void _p
      const { [kind]: _k, ...others } = cardErrors
      void _k
      cardErrors = Object.keys(params).length || errs.general ? { ...others, [kind]: { params, general: errs.general } } : others
    }
    this.set({ draft: { ...this.snap.draft, [kind]: { ...card, values: { ...card.values, [key]: text } } }, cardErrors, notice: null })
    if (card.enabled) this.schedule()
  }

  /** One card back to its defaults and switched off. */
  resetCard(kind: WhatIfKind): void {
    const { [kind]: _drop, ...rest } = this.snap.cardErrors
    void _drop
    this.set({ draft: { ...this.snap.draft, [kind]: defaultCard(kind) }, cardErrors: rest, notice: null })
    this.schedule()
  }

  /** Everything back to defaults; the result is cleared. */
  resetAll(): void {
    this.clearTimer()
    this.inflight?.abort()
    this.inflight = null
    this.seq++
    this.set({ draft: defaultDraft(), cardErrors: {}, result: null, calc: 'idle', calcError: null, notice: null, saveErrors: {} })
  }

  hasChanges(): boolean { return enabledKinds(this.snap.draft).length > 0 }

  // ── Calculation ───────────────────────────────────────────────────────

  private schedule(): void {
    this.clearTimer()
    // The answer to the previous edit is outdated now: do not wait for it.
    this.inflight?.abort()
    this.inflight = null
    this.seq++
    const built = buildChanges(this.snap.draft, this.snap.applicable)
    if (built.changes.length === 0 && !hasErrors(built.errors)) {
      this.set({ result: null, calc: 'idle', calcError: null })
      return
    }
    this.set({ calc: 'waiting', calcError: null })
    this.timer = setTimeout(() => { this.timer = null; void this.calculate() }, this.options.debounceMs ?? DEBOUNCE_MS)
  }

  /** Sends the current set of changes now. Invalid input is not sent: the fields explain. */
  async calculate(): Promise<void> {
    this.clearTimer()
    const built = buildChanges(this.snap.draft, this.snap.applicable)
    if (hasErrors(built.errors)) {
      this.inflight?.abort()
      this.inflight = null
      this.seq++
      this.set({ cardErrors: built.errors, calc: 'invalid', calcError: null })
      return
    }
    if (built.changes.length === 0) {
      this.inflight?.abort()
      this.inflight = null
      this.seq++
      this.set({ cardErrors: {}, result: null, calc: 'idle', calcError: null })
      return
    }
    this.inflight?.abort()
    const ac = new AbortController()
    this.inflight = ac
    const my = ++this.seq
    this.set({ cardErrors: {}, calc: 'loading', calcError: null })
    try {
      const res = await this.fetchFn('/api/v1/point-b/whatif', this.post({ changes: built.changes }, ac.signal))
      const body = (await res.json().catch(() => null)) as unknown
      if (my !== this.seq) return
      this.inflight = null
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ access: 'locked', calc: 'idle' }); return }
      const parsed = res.ok ? parseWhatIfResponse(body) : null
      if (parsed) {
        this.set({ result: parsed, level: parsed.level, applicable: parsed.applicable, calc: 'ready', calcError: null, cardErrors: {} })
        return
      }
      this.fail(res.status, body, built.kinds, res.ok)
    } catch {
      if (my !== this.seq) return
      this.inflight = null
      this.set({ calc: 'error', calcError: STATUS_TEXT[0] })
    }
  }

  /** A refusal: a field error goes under its calculator, anything else into the result area. */
  private fail(status: number, body: unknown, kinds: WhatIfKind[], ok: boolean): void {
    const field = isObj(body) ? mapServerField(body.field, kinds) : null
    const message = serverMessage(body, status, ok ? 'Не удалось прочитать расчёт' : `Не удалось посчитать (${status})`)
    if (field) {
      const cur = this.snap.cardErrors[field.kind]
      const entry = field.param ? { params: { ...(cur?.params ?? {}), [field.param]: message }, general: cur?.general ?? null } : { params: cur?.params ?? {}, general: message }
      this.set({ cardErrors: { ...this.snap.cardErrors, [field.kind]: entry }, calc: 'invalid', calcError: null })
      return
    }
    this.set({ calc: 'error', calcError: message })
  }

  // ── Saved scenarios ───────────────────────────────────────────────────

  async loadSaved(): Promise<void> {
    try {
      const res = await this.fetchFn('/api/v1/point-b/whatif/saved', { cache: 'no-store', credentials: 'include' })
      const body = (await res.json().catch(() => null)) as unknown
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ access: 'locked' }); return }
      const list = res.ok ? parseSavedList(body) : null
      if (!list) {
        this.set({ savedPhase: 'error', savedError: serverMessage(body, res.status, 'Не удалось загрузить сохранённые сценарии') })
        return
      }
      this.set({ saved: list, savedPhase: 'ready', savedError: null })
    } catch {
      this.set({ savedPhase: 'error', savedError: STATUS_TEXT[0] })
    }
  }

  setName(text: string): void {
    const { name: _drop, ...rest } = this.snap.saveErrors
    void _drop
    this.set({ name: text.slice(0, NAME_MAX), saveErrors: rest, notice: null })
  }

  setNote(text: string): void {
    const { note: _drop, ...rest } = this.snap.saveErrors
    void _drop
    this.set({ note: text.slice(0, NOTE_MAX), saveErrors: rest, notice: null })
  }

  /** Saves the current calculators under a name. The server computes the summary: only name, note and changes are sent. */
  async save(): Promise<boolean> {
    if (this.snap.saving || this.snap.readOnly) return false
    const name = this.snap.name.trim()
    const note = this.snap.note.trim()
    const built = buildChanges(this.snap.draft, this.snap.applicable)
    const errors: SaveErrors = {}
    if (!name) errors.name = 'Введите название сценария'
    else if (name.length > NAME_MAX) errors.name = `Не длиннее ${NAME_MAX} символов`
    if (note.length > NOTE_MAX) errors.note = `Не длиннее ${NOTE_MAX} символов`
    if (hasErrors(built.errors)) { errors.general = 'Исправьте значения в калькуляторах'; this.set({ cardErrors: built.errors }) }
    else if (built.changes.length === 0) errors.general = 'Включите хотя бы один калькулятор, чтобы сохранить сценарий'
    if (Object.keys(errors).length) { this.set({ saveErrors: errors, notice: null }); return false }

    this.set({ saving: true, saveErrors: {}, notice: null })
    try {
      const payload: { name: string; note?: string; changes: WhatIfChange[] } = { name, changes: built.changes }
      if (note) payload.note = note
      const res = await this.fetchFn('/api/v1/point-b/whatif/saved', this.post(payload))
      const body = (await res.json().catch(() => null)) as unknown
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ saving: false, access: 'locked' }); return false }
      if (res.ok && !(isObj(body) && body.ok === false)) {
        this.set({ saving: false, name: '', note: '', notice: 'Сценарий сохранён' })
        await this.loadSaved()
        return true
      }
      this.set({ saving: false, ...this.saveFailure(res.status, body, built.kinds) })
      return false
    } catch {
      this.set({ saving: false, saveErrors: { general: STATUS_TEXT[0] } })
      return false
    }
  }

  private saveFailure(status: number, body: unknown, kinds: WhatIfKind[]): Partial<WhatIfSnapshot> {
    if (status === 403) return { readOnly: true, saveErrors: { general: READ_ONLY_TEXT } }
    const message = serverMessage(body, status, 'Не удалось сохранить сценарий')
    if (status === 409) return { saveErrors: { general: isObj(body) && body.code === 'limit' && !/[А-Яа-яЁё]/.test(String(body.error ?? '')) ? LIMIT_TEXT : message } }
    const field = isObj(body) ? body.field : null
    if (field === 'name') return { saveErrors: { name: message } }
    if (field === 'note') return { saveErrors: { note: message } }
    const card = mapServerField(field, kinds)
    if (card) {
      const params = card.param ? { [card.param]: message } : {}
      return { cardErrors: { [card.kind]: { params, general: card.param ? null : message } }, saveErrors: { general: 'Исправьте значение, отмеченное в калькуляторе' } }
    }
    return { saveErrors: { general: message } }
  }

  /** Puts a saved scenario into the calculators (the ones the data allows) and calculates it. */
  loadScenario(id: string): void {
    const s = this.snap.saved.find((x) => x.id === id)
    if (!s) return
    const usable = s.changes.filter((c) => this.canEnable(c.kind))
    const skipped = s.changes.length - usable.length
    this.set({
      draft: draftFromChanges(usable),
      cardErrors: {},
      name: '',
      note: '',
      saveErrors: {},
      notice: skipped > 0
        ? `Загружено в калькуляторы. Часть изменений (${skipped}) пропущена: для ваших данных они недоступны.`
        : 'Загружено в калькуляторы',
    })
    this.schedule()
  }

  async remove(id: string): Promise<boolean> {
    if (this.snap.readOnly) return false
    const { [id]: _drop, ...rest } = this.snap.rowErrors
    void _drop
    this.set({ rowErrors: rest })
    try {
      const res = await this.fetchFn(`/api/v1/point-b/whatif/saved/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include', cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as unknown
      if (res.ok && !(isObj(body) && body.ok === false)) {
        this.set({ saved: this.snap.saved.filter((s) => s.id !== id), proposal: this.snap.proposal?.id === id ? null : this.snap.proposal })
        return true
      }
      if (res.status === 404) { this.set({ saved: this.snap.saved.filter((s) => s.id !== id), rowErrors: { ...this.snap.rowErrors, [id]: 'Сценарий уже удалён' } }); return false }
      if (res.status === 403) this.set({ readOnly: true })
      this.set({ rowErrors: { ...this.snap.rowErrors, [id]: res.status === 403 ? READ_ONLY_TEXT : serverMessage(body, res.status, 'Не удалось удалить сценарий') } })
      return false
    } catch {
      this.set({ rowErrors: { ...this.snap.rowErrors, [id]: STATUS_TEXT[0] } })
      return false
    }
  }

  // ── Proposing to the expert ───────────────────────────────────────────

  openProposal(id: string): void {
    const s = this.snap.saved.find((x) => x.id === id)
    if (!s || s.proposedAt || this.snap.readOnly) return
    const { [id]: _drop, ...rest } = this.snap.rowErrors
    void _drop
    this.set({ proposal: { id, comment: '' }, rowErrors: rest })
  }

  closeProposal(): void { this.set({ proposal: null }) }

  setProposalComment(text: string): void {
    if (!this.snap.proposal) return
    this.set({ proposal: { ...this.snap.proposal, comment: text.slice(0, NOTE_MAX) } })
  }

  private markProposed(id: string, at: string | null): void {
    const stamp = at ?? (this.options.now ? this.options.now() : new Date().toISOString())
    this.set({ saved: this.snap.saved.map((s) => (s.id === id ? { ...s, proposedAt: s.proposedAt ?? stamp } : s)), proposal: null, proposing: null })
  }

  /** Sends the scenario to the expert as a message. The plan is not changed. */
  async propose(id: string): Promise<boolean> {
    if (this.snap.proposing || this.snap.readOnly) return false
    const comment = (this.snap.proposal?.id === id ? this.snap.proposal.comment : '').trim()
    if (comment.length > NOTE_MAX) { this.set({ rowErrors: { ...this.snap.rowErrors, [id]: `Комментарий не длиннее ${NOTE_MAX} символов` } }); return false }
    const { [id]: _drop, ...rest } = this.snap.rowErrors
    void _drop
    this.set({ proposing: id, rowErrors: rest })
    try {
      const res = await this.fetchFn(`/api/v1/point-b/whatif/saved/${encodeURIComponent(id)}/propose`, this.post(comment ? { comment } : {}))
      const body = (await res.json().catch(() => null)) as unknown
      if (res.ok && !(isObj(body) && body.ok === false)) {
        const at = isObj(body) && isObj(body.data) && typeof body.data.proposedAt === 'string' ? body.data.proposedAt : null
        this.markProposed(id, at)
        return true
      }
      if (res.status === 409 && isObj(body) && body.code === 'already_proposed') { this.markProposed(id, null); return false }
      if (res.status === 403) this.set({ readOnly: true })
      const message = res.status === 403 ? READ_ONLY_TEXT : res.status === 404 ? 'Сценарий не найден — возможно, он уже удалён' : serverMessage(body, res.status, 'Не удалось отправить предложение')
      this.set({ proposing: null, rowErrors: { ...this.snap.rowErrors, [id]: message } })
      return false
    } catch {
      this.set({ proposing: null, rowErrors: { ...this.snap.rowErrors, [id]: STATUS_TEXT[0] } })
      return false
    }
  }
}

// ── Dev preview: the same controller on a fixture, no network ───────────

export interface WhatIfPreviewData {
  /** The answer for the preloaded changes. */
  result: WhatIfResult
  /** The answer for an empty set (the probe). */
  baseline: WhatIfResult
  saved: SavedWhatIf[]
  changes: WhatIfChange[]
}

/**
 * A `fetch` double for /dev/point-b-preview: the calculation returns the one pre-computed result of the fixture (the
 * preview does not run the engine), the saved list lives in memory.
 */
export function whatIfPreviewFetch(data: WhatIfPreviewData): typeof fetch {
  let saved = [...data.saved]
  let counter = 0
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (url.endsWith('/whatif') && method === 'POST') {
      const changes = Array.isArray(payload.changes) ? payload.changes : []
      return reply(200, { ok: true, data: changes.length ? data.result : data.baseline })
    }
    if (url.endsWith('/whatif/saved') && method === 'GET') return reply(200, { ok: true, data: saved })
    if (url.endsWith('/whatif/saved') && method === 'POST') {
      const changes = Array.isArray(payload.changes) ? (payload.changes as WhatIfChange[]) : []
      saved = [{ id: `preview-${++counter}`, name: String(payload.name ?? ''), note: typeof payload.note === 'string' ? payload.note : null, changes, summary: { level: data.result.level, delta: data.result.delta }, modelVersion: data.result.modelVersion, proposedAt: null, createdAt: data.result.computedAt }, ...saved]
      return reply(200, { ok: true })
    }
    const propose = /\/whatif\/saved\/([^/]+)\/propose$/.exec(url)
    if (propose && method === 'POST') {
      const id = decodeURIComponent(propose[1])
      saved = saved.map((s) => (s.id === id ? { ...s, proposedAt: data.result.computedAt } : s))
      return reply(200, { ok: true, data: { proposedAt: data.result.computedAt } })
    }
    const del = /\/whatif\/saved\/([^/]+)$/.exec(url)
    if (del && method === 'DELETE') {
      saved = saved.filter((s) => s.id !== decodeURIComponent(del[1]))
      return reply(200, { ok: true })
    }
    return reply(404, { ok: false, error: 'Не найдено' })
  }) as typeof fetch
}
