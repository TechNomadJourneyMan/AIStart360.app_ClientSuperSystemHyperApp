/**
 * components/giga-panel/user360/point-b/finmodelPanelController.ts — the brain of the expert's
 * «Финмодель» panel in User 360 → «Точка Б» (plan Ф3 Task 6), free of React and of the DOM so it can
 * be tested with a fetch double (same approach as planController.ts / scenariosController.ts).
 *
 * Contract (plan Task 4), under /api/giga-admin/users/:id/point-b/finmodel:
 *   GET  → { ok, data: { defs, state: FinmodelState, warnings?: string[] } }
 *   PUT  { values: Array<{ key, value, note? }> } → { ok, data: { state } }   (the value is saved with origin `expert`)
 *   POST …/verify { keys: FinmodelKey[] } → { ok }   (400 `not_found` for a key with no stored value; 403 not your client)
 * Errors are `{ ok:false, error, code?, field? }`; the text of the server is shown as it is.
 *
 * The rules of the form (percent as %, fractions on the wire, only changed fields) are those of the
 * owner's tab and come from components/point-b/finmodelController. Verification is offered only for
 * values typed by people (owner or expert) and never for a value with unsaved edits.
 */
import { FINMODEL_KEYS, type FinmodelKey } from '@/lib/point-b/finmodel/keys'
import {
  EMPTY_FINMODEL, NOTE_MAX, canVerify, changedKeys, errorField, formFromState, parseFinmodelResponse, planSave, serverMessage,
  type FinmodelStateView, type FormText,
} from '@/components/point-b/finmodelController'

export interface PanelSnapshot {
  phase: 'loading' | 'ready' | 'error'
  /** Failure of the load. */
  error: string | null
  state: FinmodelStateView
  /** Warnings of the calculation (e.g. the model expenses differ from the fact), when the server sends them. */
  warnings: string[]
  form: FormText
  note: string
  fieldErrors: Partial<Record<FinmodelKey | 'note', string>>
  /** Rows ticked for «Подтвердить выбранные». */
  selected: FinmodelKey[]
  busy: 'save' | 'verify' | null
  notice: string | null
  /** A failure of an action that is not about one field (403, 409, 400 not_found…). */
  actionError: string | null
}

export const INITIAL_PANEL_SNAPSHOT: PanelSnapshot = {
  phase: 'loading', error: null, state: EMPTY_FINMODEL, warnings: [], form: formFromState(EMPTY_FINMODEL), note: '',
  fieldErrors: {}, selected: [], busy: null, notice: null, actionError: null,
}

const FALLBACK: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  400: 'Сервер отклонил запрос — проверьте значения',
  403: 'Недостаточно прав или клиент вам не назначен',
  409: 'Данные изменились — обновите панель',
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The keys of the selection that may be verified: stored from people and not edited in the form. */
export function verifiableSelection(state: FinmodelStateView, form: FormText, selected: FinmodelKey[]): FinmodelKey[] {
  const edited = new Set(changedKeys(form, state))
  return selected.filter((k) => canVerify(state.values[k]) && !edited.has(k))
}

export class FinmodelPanelController {
  private snap: PanelSnapshot = INITIAL_PANEL_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly userId: string, private readonly fetchFn: typeof fetch) {}

  private url(suffix = ''): string { return `/api/giga-admin/users/${this.userId}/point-b/finmodel${suffix}` }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): PanelSnapshot => this.snap

  private set(patch: Partial<PanelSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  private adopt(state: FinmodelStateView, warnings: string[], extra: Partial<PanelSnapshot> = {}): void {
    this.set({ phase: 'ready', error: null, state, warnings, form: formFromState(state), fieldErrors: {}, selected: [], ...extra })
  }

  private message(body: unknown, status: number): string {
    return serverMessage(body, status, FALLBACK[status] ?? `Ошибка сервера (${status})`)
  }

  async load(): Promise<void> {
    const my = ++this.seq
    if (this.snap.phase !== 'ready') this.set({ phase: 'loading', error: null })
    try {
      const res = await this.fetchFn(this.url(), { credentials: 'include', cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as unknown
      if (my !== this.seq) return
      const parsed = res.ok ? parseFinmodelResponse(body) : null
      if (!parsed) {
        this.set({ phase: 'error', error: res.ok ? 'Не удалось прочитать финмодель' : this.message(body, res.status) })
        return
      }
      this.adopt(parsed.state, parsed.warnings)
    } catch {
      if (my !== this.seq) return
      this.set({ phase: 'error', error: FALLBACK[0] })
    }
  }

  setField(key: FinmodelKey, text: string): void {
    const { [key]: _drop, ...rest } = this.snap.fieldErrors
    void _drop
    this.set({ form: { ...this.snap.form, [key]: text }, fieldErrors: rest, notice: null, actionError: null })
  }

  setNote(text: string): void {
    const { note: _drop, ...rest } = this.snap.fieldErrors
    void _drop
    this.set({ note: text.slice(0, NOTE_MAX), fieldErrors: rest, notice: null, actionError: null })
  }

  /** Tick / untick a row; a row that cannot be verified is ignored. */
  toggle(key: FinmodelKey): void {
    if (!canVerify(this.snap.state.values[key])) return
    const on = this.snap.selected.includes(key)
    this.set({ selected: on ? this.snap.selected.filter((k) => k !== key) : FINMODEL_KEYS.filter((k) => k === key || this.snap.selected.includes(k)), notice: null, actionError: null })
  }

  hasChanges(): boolean { return changedKeys(this.snap.form, this.snap.state).length > 0 }

  private async call(method: 'PUT' | 'POST', url: string, json: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
    try {
      const res = await this.fetchFn(url, {
        method, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json),
      })
      const body = (await res.json().catch(() => null)) as unknown
      return { ok: res.ok && !(isObj(body) && body.ok === false), status: res.status, body }
    } catch {
      return { ok: false, status: 0, body: null }
    }
  }

  /** Saves the changed fields as the expert's (origin `expert`). A saved value is `entered` again until it is verified. */
  async save(): Promise<boolean> {
    if (this.snap.busy) return false
    const plan = planSave(this.snap.form, this.snap.state, this.snap.note)
    if (Object.keys(plan.errors).length) { this.set({ fieldErrors: plan.errors, notice: null, actionError: 'Исправьте значения, отмеченные в таблице' }); return false }
    if (plan.values.length === 0) { this.set({ notice: 'Изменений нет', actionError: null }); return false }
    this.set({ busy: 'save', notice: null, actionError: null, fieldErrors: {} })
    const r = await this.call('PUT', this.url(), { values: plan.values })
    const parsed = r.ok ? parseFinmodelResponse(r.body) : null
    if (!parsed) {
      const field = r.ok ? null : errorField(r.body)
      const text = r.ok ? 'Сервер вернул ответ, который не удалось прочитать' : this.message(r.body, r.status)
      this.set({ busy: null, fieldErrors: field ? { [field]: text } : {}, actionError: field ? 'Исправьте значение, отмеченное в таблице' : text })
      return false
    }
    this.adopt(parsed.state, parsed.warnings.length ? parsed.warnings : this.snap.warnings, { busy: null, note: '', notice: 'Сохранено как значения эксперта. Подтвердите их, когда проверите.' })
    return true
  }

  /** «Подтвердить выбранные»: marks the ticked values as verified by this expert. */
  async verify(): Promise<boolean> {
    if (this.snap.busy) return false
    const { state, form, selected } = this.snap
    if (selected.length === 0) { this.set({ actionError: 'Отметьте значения, которые вы проверили', notice: null }); return false }
    const keys = verifiableSelection(state, form, selected)
    if (keys.length !== selected.length) {
      this.set({ actionError: 'Сначала сохраните правки в отмеченных строках: подтверждается сохранённое значение', notice: null })
      return false
    }
    this.set({ busy: 'verify', notice: null, actionError: null })
    const r = await this.call('POST', this.url('/verify'), { keys })
    if (!r.ok) { this.set({ busy: null, actionError: this.message(r.body, r.status) }); return false }
    // The answer of verify is not relied on for the values: read them again.
    this.set({ busy: null })
    const count = keys.length
    await this.load()
    this.set({ notice: count === 1 ? 'Значение подтверждено' : `Подтверждено значений: ${count}` })
    return true
  }
}

// ── What a row says ─────────────────────────────────────────────────────

export interface RowStatus { label: string; tone: 'green' | 'amber' | 'neutral' | 'red'; hint: string }

/** The status column: verified, typed but not verified, taken from the platform, an assumption or nothing at all. */
export function rowStatus(state: FinmodelStateView, key: FinmodelKey): RowStatus {
  const v = state.values[key]
  if (!v) return { label: 'Нет значения', tone: 'red', hint: 'Данных нет: уровень 2 не считается, пока значения нет' }
  if (v.status === 'verified') return { label: 'Проверено', tone: 'green', hint: 'Подтверждено экспертом' }
  if (v.origin === 'default') return { label: 'Допущение по умолчанию', tone: 'amber', hint: 'Взято из шаблона отрасли, диапазон расчёта шире. Введите значение клиента, чтобы заменить.' }
  if (v.origin === 'survey' || v.origin === 'metric') return { label: 'Из данных клиента', tone: 'neutral', hint: 'Подставлено автоматически, подтверждать нечего. Правка эксперта заменит значение.' }
  return { label: 'Не проверено', tone: 'amber', hint: 'Введено человеком и ждёт подтверждения эксперта' }
}

/** Warnings that point at a mismatch with the fact (shown with more weight). */
export const isMismatchWarning = (w: string): boolean => /расходы по модели расходятся|расхожд/i.test(w)
