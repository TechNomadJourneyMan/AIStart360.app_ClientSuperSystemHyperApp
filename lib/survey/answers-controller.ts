/**
 * lib/survey/answers-controller.ts — the questionnaire answers of one owner in
 * the browser: load, edit, local draft, save (spec 2026-10-23 §5.1, §13
 * `useSurveyAnswers`, §14.2). Pure TypeScript — `fetch` and `localStorage` are
 * passed in, so the whole flow is tested without a browser; the React hook
 * (hooks/useSurveyAnswers.ts) adds only timers and lifecycle.
 *
 * Same rules as the full questionnaire wizard (app/client/onboarding/page.tsx):
 *  • the SERVER is the source of truth; unsaved edits live in the per-user
 *    draft and are laid on top on load — unless the answer changed on the
 *    server after the edit started (another mode, an expert): then the server
 *    answer wins and the key is reported in `staleKeys`;
 *  • a save sends ONLY changed keys (values edited elsewhere are never
 *    overwritten), saves are serialized, a key edited again while its save was
 *    in flight stays unsaved;
 *  • «не знаю» / «примерно» go as their own envelope;
 *  • step-1 company fields are mirrored into `companies` (once the name exists);
 *  • «год = месяц × 12» follows a month answer (as the step-1 form does).
 * It never sends `final`: «Анкета заполнена» is the full questionnaire's submit
 * (PO 2026-10-23, spec §18.3 item 1).
 */
import { toAnswerEnvelope } from './answer-value'
import type { AnswerAttribution } from './attribution-label'
import { clearDraft, mergeServerAndDraft, readDraft, updatedAtOf, writeDraft } from './draft'
import { autoYearUpdate } from './number-input'
import { AUTO_KEYS, stepForQuestionKey } from './steps'
import { profanityRejection } from '@/lib/moderation/client'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
/** The path the answers are written with (survey_answers.updated_via, migration 134). */
export type ControllerVia = 'full' | 'express'
export type AnswerOrigin = 'document' | 'chat'

interface JsonResponse { ok: boolean; status: number; json(): Promise<unknown> }
export type SurveyFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: 'include' }) => Promise<JsonResponse>
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface SurveyAnswersState {
  loaded: boolean
  answers: Readonly<Record<string, unknown>>
  attribution: Readonly<Record<string, AnswerAttribution>>
  companyId: string | null
  companyName: string | null
  saveState: SaveState
  savedAt: Date | null
  /** A user-facing error (load / save); null when fine. */
  error: string | null
  /** A question the server refused (profanity): the note sits next to it. */
  fieldIssue: { key: string; message: string } | null
  /** Unsaved local edits dropped because the answer changed elsewhere. */
  staleKeys: readonly string[]
  dirtyKeys: readonly string[]
}

export interface SaveResult { ok: boolean; error?: string }

/** Step-1 fields mirrored into the `companies` row (as the wizard). */
export const COMPANY_FIELD_KEYS: ReadonlySet<string> = new Set([
  's1_company_name', 's1_industry', 's1_employee_count', 's1_founded_at', 's1_business_model',
  's1_regions', 's1_contact_name', 's1_contact_position', 's1_contact_phone', 's1_contact_email',
])

/** month key → its «год = месяц × 12» key. */
const YEAR_OF_MONTH: Readonly<Record<string, string>> = Object.fromEntries(AUTO_KEYS.map((y) => [y.replace(/_year$/, '_month'), y]))

/** /api/v1/onboarding/company body field → question key (for a refused field). */
const COMPANY_BODY_TO_KEY: Readonly<Record<string, string>> = {
  name: 's1_company_name', industry: 's1_industry', regions: 's1_regions', business_model: 's1_business_model',
  contact_name: 's1_contact_name', contact_position: 's1_contact_position', contact_phone: 's1_contact_phone', contact_email: 's1_contact_email',
}

const SESSION_LOST = 'Сессия истекла — войдите заново. Ответы сохранены на этом устройстве.'

class FieldRejected extends Error {
  constructor(message: string, readonly field: string | null) { super(message) }
}

export class SurveyAnswersController {
  private state: SurveyAnswersState = {
    loaded: false, answers: {}, attribution: {}, companyId: null, companyName: null,
    saveState: 'idle', savedAt: null, error: null, fieldIssue: null, staleKeys: [], dirtyKeys: [],
  }
  private readonly dirty = new Set<string>()
  private readonly origins = new Map<string, AnswerOrigin>()
  private base: Record<string, string | null> = {}
  private draftStep = 1
  private chain: Promise<SaveResult> = Promise.resolve({ ok: true })
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly opts: { userId: string; via: ControllerVia; fetch: SurveyFetch; storage?: StorageLike | null; now?: () => Date },
  ) {}

  // ── Subscription (useSyncExternalStore) ──────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getState = (): SurveyAnswersState => this.state
  private set(patch: Partial<SurveyAnswersState>): void {
    this.state = { ...this.state, ...patch, dirtyKeys: [...this.dirty] }
    for (const l of this.listeners) l()
  }

  get hasUnsaved(): boolean { return this.dirty.size > 0 }

  // ── Load ─────────────────────────────────────────────────────────────────
  /** Server answers + author lines + company, this user's draft on top. */
  async load(): Promise<SaveResult> {
    let server: Record<string, unknown> = {}
    let attribution: Record<string, AnswerAttribution> = {}
    let error: string | null = null
    let companyId: string | null = null
    let companyName: string | null = null
    try {
      const [surveyRes, companyRes] = await Promise.all([
        this.opts.fetch('/api/v1/onboarding/survey', { credentials: 'include' }),
        this.opts.fetch('/api/v1/onboarding/company', { credentials: 'include' }),
      ])
      const survey = (await surveyRes.json().catch(() => null)) as { ok?: boolean; data?: { answers?: Record<string, unknown>; attribution?: Record<string, AnswerAttribution> } } | null
      if (surveyRes.ok && survey?.ok) {
        server = survey.data?.answers ?? {}
        attribution = survey.data?.attribution ?? {}
      } else {
        error = 'Не удалось загрузить сохранённые ответы. Обновите страницу, прежде чем продолжать.'
      }
      const company = (await companyRes.json().catch(() => null)) as { ok?: boolean; data?: { id?: unknown; name?: unknown } } | null
      if (companyRes.ok && company?.ok && company.data?.id) {
        companyId = String(company.data.id)
        companyName = typeof company.data.name === 'string' && company.data.name.trim() ? company.data.name.trim() : null
      }
    } catch {
      error = 'Нет связи с сервером. Ответы сохраняются на этом устройстве и отправятся, когда связь вернётся.'
    }
    const draft = this.opts.storage ? readDraft(this.opts.storage, this.opts.userId) : null
    const serverAt = updatedAtOf(attribution)
    const merged = mergeServerAndDraft(server, draft, serverAt)
    this.dirty.clear()
    for (const k of merged.dirtyKeys) this.dirty.add(k)
    this.base = Object.fromEntries(merged.dirtyKeys.map((k) => [k, draft?.base?.[k] ?? serverAt[k] ?? null]))
    this.draftStep = draft?.current_step ?? 1
    this.set({
      loaded: true, answers: merged.answers, attribution, companyId, companyName, error,
      staleKeys: merged.staleKeys, saveState: this.dirty.size ? 'dirty' : 'idle',
    })
    if (merged.staleKeys.length) this.persistDraft()
    return { ok: error === null, ...(error ? { error } : {}) }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────
  /** A field changed. `origin`: accepted from a document / confirmed in the field «Помощник». */
  change(key: string, value: unknown, origin?: AnswerOrigin): void {
    const answers: Record<string, unknown> = { ...this.state.answers, [key]: value }
    this.markDirty(key, origin)
    const yearKey = YEAR_OF_MONTH[key]
    if (yearKey) {
      const year = autoYearUpdate(value, answers[yearKey], true)
      if (year !== undefined) {
        answers[yearKey] = year
        this.markDirty(yearKey)
      }
    }
    const fieldIssue = this.state.fieldIssue?.key === key ? null : this.state.fieldIssue
    this.set({
      answers, fieldIssue,
      ...(fieldIssue === null && this.state.fieldIssue ? { error: null } : {}),
      saveState: this.state.saveState === 'saving' ? 'saving' : 'dirty',
    })
  }

  private markDirty(key: string, origin?: AnswerOrigin): void {
    if (!this.dirty.has(key)) this.base[key] = this.state.attribution[key]?.updatedAt ?? null
    this.dirty.add(key)
    if (origin) this.origins.set(key, origin)
    else this.origins.delete(key)
  }

  /** Forget the «changed elsewhere» notice. */
  dismissStale(): void { this.set({ staleKeys: [] }) }

  /** Write the unsaved edits to this user's draft (or clear it). */
  persistDraft(): void {
    const storage = this.opts.storage
    if (!storage) return
    if (this.dirty.size === 0) { clearDraft(storage, this.opts.userId); return }
    const dirty: Record<string, unknown> = {}
    for (const k of this.dirty) dirty[k] = this.state.answers[k]
    writeDraft(storage, this.opts.userId, this.draftStep, dirty, this.base)
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  /**
   * Save the unsaved edits. `autosave`: a background save while typing (no
   * Sheets mirror on the server, errors stay quiet in the chip). Serialized:
   * a call during a save waits for it. Resolves ok only when the server confirmed.
   */
  save(opts: { autosave?: boolean } = {}): Promise<SaveResult> {
    const run = () => this.saveNow(opts.autosave === true)
    const next = this.chain.then(run, run)
    this.chain = next
    return next
  }

  private async saveNow(quiet: boolean): Promise<SaveResult> {
    const keys = [...this.dirty]
    if (keys.length === 0) return { ok: true }
    const snapshot: Record<string, unknown> = {}
    for (const k of keys) snapshot[k] = this.state.answers[k]
    this.set({ saveState: 'saving' })
    try {
      await this.mirrorCompany(keys, quiet)
      const answers: Record<string, Record<string, unknown>> = {}
      for (const k of keys) answers[k] = toAnswerEnvelope(snapshot[k])
      const origins: Record<string, AnswerOrigin> = {}
      for (const k of keys) { const o = this.origins.get(k); if (o) origins[k] = o }
      const steps = keys.map((k) => stepForQuestionKey(k, null)).filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 12)
      const res = await this.opts.fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: steps.length ? Math.min(...steps) : 1,
          answers,
          autosave: quiet,
          via: this.opts.via,
          ...(Object.keys(origins).length ? { origins } : {}),
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { attribution?: Record<string, AnswerAttribution> } } | null
      if (res.status === 401) throw new Error(SESSION_LOST)
      const rejected = profanityRejection(json)
      if (rejected) throw new FieldRejected(rejected.message, rejected.field)
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      // Clear only the keys that did not change again while the request was in flight.
      const saved = json.data?.attribution ?? {}
      for (const k of keys) {
        if (Object.is(this.state.answers[k], snapshot[k])) {
          this.dirty.delete(k)
          this.origins.delete(k)
          delete this.base[k]
        } else if (saved[k]) {
          this.base[k] = saved[k].updatedAt ?? null
        }
      }
      this.set({
        attribution: { ...this.state.attribution, ...saved },
        error: null, fieldIssue: null, savedAt: (this.opts.now ?? (() => new Date()))(),
        saveState: this.dirty.size ? 'dirty' : 'saved',
      })
      this.persistDraft()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.persistDraft()
      if (e instanceof FieldRejected) {
        // Not a network problem: no retry; the answer stays in the form and the draft.
        this.set({ fieldIssue: e.field ? { key: e.field, message: e.message } : null, error: e.message, saveState: 'dirty' })
        return { ok: false, error: e.message }
      }
      const error = msg === SESSION_LOST
        ? msg
        : `Не удалось сохранить ответы (${msg}). Проверьте соединение — введённое сохранено на этом устройстве.`
      this.set({ saveState: 'error', ...(quiet && msg !== SESSION_LOST ? {} : { error }) })
      return { ok: false, error }
    }
  }

  /** Step-1 company fields → `companies` (its name is NOT NULL: waits until typed). */
  private async mirrorCompany(keys: readonly string[], quiet: boolean): Promise<void> {
    if (!keys.some((k) => COMPANY_FIELD_KEYS.has(k))) return
    const a = this.state.answers
    const name = typeof a.s1_company_name === 'string' ? a.s1_company_name.trim() : ''
    if (!name) return
    const res = await this.opts.fetch('/api/v1/onboarding/company', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, industry: a.s1_industry, employee_count: a.s1_employee_count, founded_at: a.s1_founded_at,
        business_model: a.s1_business_model, regions: a.s1_regions, contact_name: a.s1_contact_name,
        contact_position: a.s1_contact_position, contact_phone: a.s1_contact_phone, contact_email: a.s1_contact_email,
      }),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { id?: unknown } } | null
    const rejected = profanityRejection(json)
    if (rejected) throw new FieldRejected(rejected.message, COMPANY_BODY_TO_KEY[rejected.field?.split('.')[0] ?? ''] ?? null)
    if (!res.ok || !json?.ok) {
      if (quiet) return // a background save of the survey answers still goes on
      throw new Error(json?.error || `HTTP ${res.status}`)
    }
    if (json.data?.id) this.set({ companyId: String(json.data.id), companyName: name })
  }
}
