/**
 * components/point-b/finmodelController.ts — the brain of the «Финмодель» tab (plan Ф3 Task 5),
 * free of React and of the DOM so it can be tested with a fetch double (same approach as
 * pointBStateController.ts). `useFinmodel` binds it to the form; `FinmodelPanel` of the expert
 * reuses the parsing, the input rules and the badges of this file.
 *
 * Contract (plan Task 4):
 *   GET /api/v1/point-b/finmodel → { ok, data: { defs, state: FinmodelState } }
 *   PUT /api/v1/point-b/finmodel { values: Array<{ key, value, asOf?, period?, note? }> } → { ok, data: { state } }
 *       `value` is a number, a percent travels as a FRACTION 0..1; 400 { error, code: 'invalid_value', field } for a bad
 *       value, 400 with `field: 'note'` for profanity; 402 the tariff gate; 403 «от имени»; 429 the rate limit.
 * The form shows percent as percent, sends fractions, sends only the CHANGED fields. Nothing is
 * invented: a missing value stays empty (never 0), the labels come from FINMODEL_DEFS.
 */
import { FINMODEL_DEFS, FINMODEL_GROUPS, FINMODEL_KEYS, isFinmodelKey, type FinmodelKey, type FinmodelKeyDef } from '@/lib/point-b/finmodel/keys'
import { isUpgradeRequired } from './pointBAccess'
import { fmtLongDate, fmtMoney } from './overviewModel'

// ── The state as the server sends it (only what the UI reads) ───────────

export type FinmodelOriginView = 'owner' | 'expert' | 'survey' | 'metric' | 'default'

export interface FinmodelValueView {
  key: FinmodelKey
  value: number
  origin: FinmodelOriginView
  status: 'entered' | 'verified' | 'auto'
  note: string | null
  verifiedByName: string | null
  verifiedAt: string | null
  updatedAt: string | null
}

export interface FinmodelStateView {
  values: Partial<Record<FinmodelKey, FinmodelValueView>>
  missing: FinmodelKey[]
  complete: boolean
  defaulted: FinmodelKey[]
}

export const EMPTY_FINMODEL: FinmodelStateView = { values: {}, missing: [], complete: false, defaulted: [] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const keys = (v: unknown): FinmodelKey[] => (Array.isArray(v) ? v.filter(isFinmodelKey) : [])

const ORIGINS: readonly FinmodelOriginView[] = ['owner', 'expert', 'survey', 'metric', 'default']

/** Tolerant: unknown keys and non-finite numbers are dropped, never turned into 0. */
export function parseFinmodelState(v: unknown): FinmodelStateView | null {
  if (!isObj(v)) return null
  const values: FinmodelStateView['values'] = {}
  if (isObj(v.values)) {
    for (const k of FINMODEL_KEYS) {
      const raw = v.values[k]
      if (!isObj(raw) || !finite(raw.value)) continue
      const origin = ORIGINS.includes(raw.origin as FinmodelOriginView) ? (raw.origin as FinmodelOriginView) : 'owner'
      values[k] = {
        key: k,
        value: raw.value,
        origin,
        status: raw.status === 'verified' || raw.status === 'auto' ? raw.status : 'entered',
        note: str(raw.note),
        verifiedByName: str(raw.verifiedByName),
        verifiedAt: str(raw.verifiedAt),
        updatedAt: str(raw.updatedAt),
      }
    }
  }
  return { values, missing: keys(v.missing), complete: v.complete === true, defaulted: keys(v.defaulted) }
}

/** `{ ok, data: { state, warnings? } }` of a GET or a PUT. */
export function parseFinmodelResponse(body: unknown): { state: FinmodelStateView; warnings: string[] } | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.data)) return null
  const state = parseFinmodelState(body.data.state)
  if (!state) return null
  const warnings = Array.isArray(body.data.warnings) ? body.data.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : []
  return { state, warnings }
}

// ── Groups, units, input rules ──────────────────────────────────────────

export interface FinmodelGroupView { id: string; label: string; keys: FinmodelKey[] }

/** The four groups of the form, keys in definition order. */
export function finmodelGroups(): FinmodelGroupView[] {
  return FINMODEL_GROUPS.map((g) => ({ id: g.id, label: g.label, keys: FINMODEL_KEYS.filter((k) => FINMODEL_DEFS[k].group === g.id) }))
}

export const UNIT_LABEL: Record<FinmodelKeyDef['unit'], string> = { '₸': '₸', '%': '%', days: 'дней' }

/** The stored value as the text of an input: a fraction becomes percent. */
export function toInputText(def: FinmodelKeyDef, stored: number): string {
  const shown = def.unit === '%' ? Math.round(stored * 100 * 1e6) / 1e6 : stored
  return String(shown)
}

/** The range of an input in the units the owner types, for hints and errors. */
export function inputRange(def: FinmodelKeyDef): { min: number; max: number } {
  return def.unit === '%' ? { min: def.min * 100, max: def.max * 100 } : { min: def.min, max: def.max }
}

const fmtRangeNumber = (n: number): string => n.toLocaleString('ru-RU', { maximumFractionDigits: 6 })

/** Text → number to SEND (a fraction for percent); a Russian error under the field otherwise. */
export function parseInput(def: FinmodelKeyDef, text: string): { ok: true; value: number } | { ok: false; error: string } {
  const cleaned = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (cleaned === '') return { ok: false, error: 'Введите число' }
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, error: 'Введите число цифрами, например 1500000' }
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return { ok: false, error: 'Введите число цифрами' }
  const { min, max } = inputRange(def)
  if (n < 0) return { ok: false, error: 'Значение не может быть отрицательным' }
  if (n < min || n > max) return { ok: false, error: `Допустимо от ${fmtRangeNumber(min)} до ${fmtRangeNumber(max)}${def.unit === '%' ? '%' : def.unit === 'days' ? ' дней' : ' ₸'}` }
  return { ok: true, value: def.unit === '%' ? Math.round((n / 100) * 1e9) / 1e9 : n }
}

/** «≈ 1,5 млн ₸» under a money field, so a slip of a zero is visible; null for other units or text. */
export function moneyPreview(def: FinmodelKeyDef, text: string): string | null {
  if (def.unit !== '₸') return null
  const p = parseInput(def, text)
  return p.ok && p.value >= 1000 ? `≈ ${fmtMoney(p.value)}` : null
}

// ── Origin badges ───────────────────────────────────────────────────────

export interface OriginBadge { label: string; tone: 'good' | 'neutral' | 'warn' }

/** `проверено экспертом · имя · дата` | `введено вами` | `из анкеты` | `из данных платформы` | `допущение по отрасли`. */
export function originBadge(v: FinmodelValueView | undefined, viewer: 'owner' | 'expert' = 'owner'): OriginBadge | null {
  if (!v) return null
  if (v.status === 'verified') {
    const parts = ['проверено экспертом']
    if (v.verifiedByName) parts.push(v.verifiedByName)
    const date = fmtLongDate(v.verifiedAt)
    if (date) parts.push(date)
    return { label: parts.join(' · '), tone: 'good' }
  }
  if (v.origin === 'default') return { label: 'допущение по отрасли', tone: 'warn' }
  if (v.origin === 'survey') return { label: 'из анкеты', tone: 'neutral' }
  if (v.origin === 'metric') return { label: 'из данных платформы', tone: 'neutral' }
  if (v.origin === 'expert') return { label: viewer === 'expert' ? 'введено экспертом' : 'введено экспертом, не проверено', tone: 'neutral' }
  return { label: viewer === 'owner' ? 'введено вами' : 'введено владельцем', tone: 'neutral' }
}

/** Only values typed by people can be verified (the platform and the industry assumption are not «проверяются»). */
export function canVerify(v: FinmodelValueView | undefined): boolean {
  return !!v && v.status === 'entered' && (v.origin === 'owner' || v.origin === 'expert')
}

// ── The form ────────────────────────────────────────────────────────────

export type FormText = Record<FinmodelKey, string>

export function formFromState(state: FinmodelStateView): FormText {
  return Object.fromEntries(FINMODEL_KEYS.map((k) => {
    const v = state.values[k]
    return [k, v ? toInputText(FINMODEL_DEFS[k], v.value) : '']
  })) as FormText
}

/** Fields whose text differs from what the state shows (compared as numbers, so «1 500» and «1500» are one). */
export function changedKeys(form: FormText, state: FinmodelStateView): FinmodelKey[] {
  const initial = formFromState(state)
  return FINMODEL_KEYS.filter((k) => {
    const now = form[k].trim()
    if (now === initial[k].trim()) return false
    if (now === '' && initial[k] === '') return false
    const a = parseInput(FINMODEL_DEFS[k], now)
    const b = parseInput(FINMODEL_DEFS[k], initial[k])
    return !(a.ok && b.ok && a.value === b.value)
  })
}

export interface SavePlan {
  values: Array<{ key: FinmodelKey; value: number; note?: string }>
  errors: Partial<Record<FinmodelKey, string>>
}

export const NOTE_MAX = 500

/** What to send: the changed fields, validated; `note` rides with every changed value. */
export function planSave(form: FormText, state: FinmodelStateView, note: string): SavePlan {
  const out: SavePlan = { values: [], errors: {} }
  const n = note.trim()
  for (const k of changedKeys(form, state)) {
    const p = parseInput(FINMODEL_DEFS[k], form[k])
    if (p.ok) out.values.push(n ? { key: k, value: p.value, note: n } : { key: k, value: p.value })
    else out.errors[k] = p.error
  }
  return out
}

/** Which keys of the group are still without a value (the frame «Нужно для расчёта денег»). */
export const isMissing = (state: FinmodelStateView, k: FinmodelKey): boolean => state.missing.includes(k)

/** «заполнено N из M» of the inputs level 2 needs. */
export function stateProgress(state: FinmodelStateView): { filled: number; total: number } {
  const hard = FINMODEL_KEYS.filter((k) => FINMODEL_DEFS[k].required)
  const conditional = state.missing.filter((k) => !FINMODEL_DEFS[k].required)
  const total = hard.length + conditional.length
  return { filled: Math.max(0, total - state.missing.length), total }
}

// ── Requests ────────────────────────────────────────────────────────────

export type FinmodelPhase = 'loading' | 'ready' | 'error' | 'locked'

export interface FinmodelSnapshot {
  phase: FinmodelPhase
  /** Failure of the load. */
  error: string | null
  state: FinmodelStateView
  form: FormText
  note: string
  fieldErrors: Partial<Record<FinmodelKey | 'note', string>>
  saving: boolean
  notice: string | null
  /** A failure of the save that is not about one field. */
  saveError: string | null
}

const EMPTY_FORM = formFromState(EMPTY_FINMODEL)

export const INITIAL_FINMODEL_SNAPSHOT: FinmodelSnapshot = {
  phase: 'loading', error: null, state: EMPTY_FINMODEL, form: EMPTY_FORM, note: '', fieldErrors: {}, saving: false, notice: null, saveError: null,
}

const STATUS_TEXT: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'Нет доступа к этому разделу',
  404: 'Данные не найдены',
  429: 'Слишком много запросов. Подождите немного и повторите.',
}

/** The server text when it is human (Russian); otherwise ours by status. */
export function serverMessage(body: unknown, status: number, fallback: string): string {
  const text = isObj(body) && typeof body.error === 'string' ? body.error : isObj(body) && typeof body.message === 'string' ? body.message : ''
  if (/[А-Яа-яЁё]/.test(text)) return text
  return STATUS_TEXT[status] ?? (status >= 500 ? 'Ошибка сервера. Попробуйте позже.' : fallback)
}

/** `field` of a 400: a finmodel key or `note`. */
export function errorField(body: unknown): FinmodelKey | 'note' | null {
  const f = isObj(body) ? body.field : null
  return f === 'note' ? 'note' : isFinmodelKey(f) ? f : null
}

export interface FinmodelControllerOptions {
  /** Called after a successful save: the overview and the scenarios are recalculated from the new money. */
  onSaved?: () => void
}

export class FinmodelController {
  private snap: FinmodelSnapshot = INITIAL_FINMODEL_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly fetchFn: typeof fetch, private readonly options: FinmodelControllerOptions = {}) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): FinmodelSnapshot => this.snap

  private set(patch: Partial<FinmodelSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  private adopt(state: FinmodelStateView, extra: Partial<FinmodelSnapshot> = {}): void {
    this.set({ phase: 'ready', error: null, state, form: formFromState(state), fieldErrors: {}, ...extra })
  }

  async load(): Promise<void> {
    const my = ++this.seq
    if (this.snap.phase !== 'ready') this.set({ phase: 'loading', error: null })
    try {
      const res = await this.fetchFn('/api/v1/point-b/finmodel', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as unknown
      if (my !== this.seq) return
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ phase: 'locked', error: null }); return }
      const parsed = res.ok ? parseFinmodelResponse(body) : null
      if (!parsed) {
        this.set({ phase: 'error', error: serverMessage(body, res.status, res.ok ? 'Не удалось прочитать финмодель' : `Не удалось загрузить финмодель (${res.status})`) })
        return
      }
      this.adopt(parsed.state)
    } catch {
      if (my !== this.seq) return
      this.set({ phase: 'error', error: STATUS_TEXT[0] })
    }
  }

  /** Typing clears the error of that field and the «Сохранено» notice. */
  setField(key: FinmodelKey, text: string): void {
    const { [key]: _drop, ...rest } = this.snap.fieldErrors
    void _drop
    this.set({ form: { ...this.snap.form, [key]: text }, fieldErrors: rest, notice: null, saveError: null })
  }

  setNote(text: string): void {
    const { note: _drop, ...rest } = this.snap.fieldErrors
    void _drop
    this.set({ note: text.slice(0, NOTE_MAX), fieldErrors: rest, notice: null, saveError: null })
  }

  hasChanges(): boolean { return changedKeys(this.snap.form, this.snap.state).length > 0 }

  /** PUT of the changed fields only. false = nothing was saved. */
  async save(): Promise<boolean> {
    if (this.snap.saving) return false
    const plan = planSave(this.snap.form, this.snap.state, this.snap.note)
    if (Object.keys(plan.errors).length) { this.set({ fieldErrors: plan.errors, notice: null, saveError: 'Исправьте значения, отмеченные ниже' }); return false }
    if (plan.values.length === 0) { this.set({ notice: 'Изменений нет', saveError: null, fieldErrors: {} }); return false }
    this.set({ saving: true, notice: null, saveError: null, fieldErrors: {} })
    try {
      const res = await this.fetchFn('/api/v1/point-b/finmodel', {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: plan.values }),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (isUpgradeRequired(res.status, isObj(body) ? body : null)) { this.set({ saving: false, phase: 'locked' }); return false }
      const parsed = res.ok && !(isObj(body) && body.ok === false) ? parseFinmodelResponse(body) : null
      if (!parsed) {
        const field = res.ok ? null : errorField(body)
        const message = serverMessage(body, res.status, res.ok ? 'Сервер вернул ответ, который не удалось прочитать' : 'Не удалось сохранить')
        this.set({
          saving: false,
          fieldErrors: field ? { [field]: message } : {},
          saveError: field ? 'Исправьте значение, отмеченное ниже' : message,
        })
        return false
      }
      this.adopt(parsed.state, { saving: false, note: '', notice: 'Сохранено. Деньги в «Обзоре» и «Сценариях» пересчитаются.', saveError: null })
      this.options.onSaved?.()
      return true
    } catch {
      this.set({ saving: false, saveError: STATUS_TEXT[0] })
      return false
    }
  }
}

// ── Dev preview: the same controller on a fixture, no network ───────────

/** A `fetch` double for /dev/point-b-preview: GET returns the fixture, PUT applies the values as the owner's. */
export function previewFetch(initial: FinmodelStateView): typeof fetch {
  let state = initial
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
  return (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as { values: Array<{ key: FinmodelKey; value: number; note?: string }> }
      const values = { ...state.values }
      for (const v of sent.values) {
        values[v.key] = { key: v.key, value: v.value, origin: 'owner', status: 'entered', note: v.note ?? null, verifiedByName: null, verifiedAt: null, updatedAt: null }
      }
      const filled = new Set(Object.keys(values))
      const missing = state.missing.filter((k) => !filled.has(k))
      state = { values, missing, complete: missing.length === 0, defaulted: state.defaulted.filter((k) => values[k]?.origin === 'default') }
    }
    return reply(200, { ok: true, data: { state } })
  }) as typeof fetch
}
