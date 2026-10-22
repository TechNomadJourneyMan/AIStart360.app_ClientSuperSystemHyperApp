/**
 * components/giga-panel/user360/point-b/recommendationsController.ts — the brain of the expert's «Рекомендации» panel in
 * User 360 → «Точка Б» and of the «Рекомендации на проверке» block of the admin queue (plan Ф6a Task 8, spec §12, §15.4),
 * free of React and of the DOM so it can be tested with a fetch double (same approach as scenariosController.ts).
 *
 * Contract (plan Ф6a Task 6):
 *   GET   /api/giga-admin/users/:id/point-b/recommendations                → { ok, data: { items: Recommendation[], counts? } }
 *   POST  …/recommendations { action: 'generate_ai' }                       → { ok, data: { created: Recommendation[], warnings: string[] } }
 *   POST  …/recommendations { action: 'run_rules' }                         → { ok, data: { created: number, skipped: number } }
 *   POST  …/recommendations { action: 'create', draft, scopeNote }          → { ok, data: Recommendation }   (verified at once)
 *   PATCH …/recommendations/:recId { action: 'verify', scopeNote, comment? } → { ok, data: Recommendation }
 *   PATCH …/recommendations/:recId { action: 'reject', comment }            → { ok, data: Recommendation }
 *   PATCH …/recommendations/:recId { action: 'edit', patch }                → { ok, data: Recommendation }   (a new pending version)
 *   GET   /api/giga-admin/point-b/recommendations/queue                     → { ok, data: Array<pending item> }
 * Errors are `{ ok:false, error, code?, field? }`: 400 (invalid, profanity with the field), 403, 404, 409 (bad_state),
 * 429 (the hourly limit of AI generation). The text of the server is shown as it is.
 *
 * The verification marks («проверено экспертом», name, specialty, date) are set by the SERVER from the actor's profile;
 * the panel only sends the scope note and the comment. Answers are read tolerantly (camelCase or snake_case, `items`
 * or a bare array), so the panel works against the store's rows as well as against a mapped view.
 */
import type { RecKind, RecSource, RecSourceRef, RecStatus, Recommendation } from '@/lib/point-b/recs/types'
import { fmtLongDate } from '@/components/point-b/overviewModel'
import { CONFIDENCE_LABEL, REC_KIND_LABEL, parseSourceRefs } from '@/components/point-b/recsModel'

export { CONFIDENCE_LABEL, REC_KIND_LABEL }

export const AI_WARNING_TEXT = 'ИИ может ошибаться: проверьте числа и ссылки на данные'

export const STATUS_ORDER: readonly RecStatus[] = ['pending_review', 'expert_verified', 'expert_rejected', 'stale']

export const STATUS_GROUP_LABEL: Record<RecStatus, string> = {
  pending_review: 'На проверке',
  expert_verified: 'Проверены',
  expert_rejected: 'Отклонены',
  stale: 'Требуют обновления',
}

export const SOURCE_LABEL: Record<RecSource, string> = { rule: 'Правило', ai: 'ИИ', expert: 'Эксперт' }

export const REC_KINDS: readonly RecKind[] = ['lever', 'risk', 'action', 'contradiction', 'constraint']
export const CONFIDENCES: ReadonlyArray<Recommendation['confidence']> = ['low', 'medium', 'high']

/** Lengths of the store (migration 129): the form only avoids obviously doomed requests. */
export const LIMITS = { title: 200, text: 2000, scope: 2000, comment: 2000 } as const

// ── Parsing ─────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

export function parseRecommendation(v: unknown): Recommendation | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const title = str(v.title)
  const status = pick(v, 'status') as RecStatus
  if (!id || !title || !STATUS_ORDER.includes(status)) return null
  const kind = pick(v, 'kind') as RecKind
  const confidence = pick(v, 'confidence') as Recommendation['confidence']
  const gen = pick(v, 'generatedBy', 'generated_by') as RecSource
  const ver = pick(v, 'recVersion', 'rec_version')
  return {
    id,
    companyId: str(pick(v, 'companyId', 'company_id')) ?? '',
    versionId: str(pick(v, 'versionId', 'version_id')),
    kind: REC_KINDS.includes(kind) ? kind : 'action',
    title,
    essence: str(v.essence) ?? '',
    reason: str(v.reason) ?? '',
    expectedEffect: str(pick(v, 'expectedEffect', 'expected_effect')),
    resources: str(v.resources),
    confidence: CONFIDENCES.includes(confidence) ? confidence : 'medium',
    confidenceReason: str(pick(v, 'confidenceReason', 'confidence_reason')),
    risks: str(v.risks),
    nextAction: str(pick(v, 'nextAction', 'next_action')),
    sourceRefs: parseSourceRefs(pick(v, 'sourceRefs', 'source_refs')),
    status,
    generatedBy: gen === 'rule' || gen === 'ai' || gen === 'expert' ? gen : 'ai',
    inputsHash: str(pick(v, 'inputsHash', 'inputs_hash')),
    recVersion: typeof ver === 'number' && Number.isFinite(ver) && ver >= 1 ? Math.floor(ver) : 1,
    supersedesId: str(pick(v, 'supersedesId', 'supersedes_id')),
    reviewerName: str(pick(v, 'reviewerName', 'reviewer_name')),
    reviewerSpecialty: str(pick(v, 'reviewerSpecialty', 'reviewer_specialty')),
    reviewedAt: str(pick(v, 'reviewedAt', 'reviewed_at')),
    scopeNote: str(pick(v, 'scopeNote', 'scope_note')),
    reviewComment: str(pick(v, 'reviewComment', 'review_comment')),
    createdAt: str(pick(v, 'createdAt', 'created_at')) ?? '',
    updatedAt: str(pick(v, 'updatedAt', 'updated_at')) ?? '',
  }
}

function listOf(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data
  if (!isObj(data)) return []
  for (const k of keys) if (Array.isArray(data[k])) return data[k] as unknown[]
  return []
}

export function parseRecommendationList(body: unknown): Recommendation[] | null {
  if (!isObj(body) || body.ok === false) return null
  return listOf(body.data, 'items', 'recommendations').map(parseRecommendation).filter((r): r is Recommendation => !!r)
}

export interface RecGroup { status: RecStatus; label: string; items: Recommendation[] }

/** On review · verified · rejected · need an update — the newest first inside a group; empty groups are left out. */
export function groupByStatus(recs: Recommendation[]): RecGroup[] {
  return STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_GROUP_LABEL[status],
    items: recs.filter((r) => r.status === status).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
  })).filter((g) => g.items.length > 0)
}

export function statusCounts(recs: Recommendation[]): Record<RecStatus, number> {
  const out = { pending_review: 0, expert_verified: 0, expert_rejected: 0, stale: 0 } as Record<RecStatus, number>
  for (const r of recs) out[r.status] += 1
  return out
}

/** «Для плана v2, данные на 14 октября 2026 г.» — the default scope of a verification (the expert edits it). */
export function defaultScopeNote(rec: Pick<Recommendation, 'versionId' | 'createdAt'>, versionNumbers: Record<string, number> = {}, fallbackVersion: number | null = null): string {
  const n = (rec.versionId ? versionNumbers[rec.versionId] : undefined) ?? fallbackVersion
  const date = fmtLongDate(rec.createdAt)
  return `${n ? `Для плана v${n}` : 'Для текущего плана'}${date ? `, данные на ${date}` : ''}`
}

const AI_WARNINGS: Record<string, string> = {
  too_soon: 'ИИ уже вызывался для этого клиента меньше 10 минут назад — попробуйте позже',
  budget: 'Исчерпан бюджет ИИ — генерация не выполнена',
  budget_exceeded: 'Исчерпан бюджет ИИ — генерация не выполнена',
  no_api_key: 'ИИ сейчас недоступен (не настроен ключ)',
  no_key: 'ИИ сейчас недоступен (не настроен ключ)',
  gateway_error: 'ИИ не ответил — попробуйте позже',
  invalid_json: 'ИИ вернул ответ, который не удалось прочитать',
  timeout: 'ИИ не успел ответить — попробуйте позже',
}

/** A warning of the generation in Russian: a known code is translated, a Russian text is kept as it is. */
export function warningText(w: string): string {
  return AI_WARNINGS[w] ?? w
}

// ── The queue of the admin page ─────────────────────────────────────────

export interface RecQueueRow {
  id: string
  userId: string
  clientName: string
  company: string | null
  title: string
  kind: RecKind
  generatedBy: RecSource
  createdAt: string | null
}

/** `GET /api/giga-admin/point-b/recommendations/queue`: pending items within the actor's scope, oldest first. */
export function parseRecsQueue(body: unknown): RecQueueRow[] {
  if (!isObj(body)) return []
  const rows: RecQueueRow[] = []
  for (const it of listOf(body.data, 'items', 'recommendations')) {
    if (!isObj(it)) continue
    const id = str(pick(it, 'id', 'recId', 'rec_id'))
    const userId = str(pick(it, 'userId', 'user_id', 'ownerId', 'owner_id'))
    const title = str(it.title)
    if (!id || !userId || !title) continue
    const kind = pick(it, 'kind') as RecKind
    const gen = pick(it, 'generatedBy', 'generated_by') as RecSource
    rows.push({
      id,
      userId,
      clientName: str(pick(it, 'clientName', 'client_name', 'name')) ?? 'Без имени',
      company: str(pick(it, 'companyName', 'company_name', 'company')),
      title,
      kind: REC_KINDS.includes(kind) ? kind : 'action',
      generatedBy: gen === 'rule' || gen === 'ai' || gen === 'expert' ? gen : 'ai',
      createdAt: str(pick(it, 'createdAt', 'created_at')),
    })
  }
  return rows.sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : 0))
}

// ── Forms ───────────────────────────────────────────────────────────────

export type EditableField = 'title' | 'essence' | 'reason' | 'expectedEffect' | 'resources' | 'confidence' | 'confidenceReason' | 'risks' | 'nextAction'
export const EDITABLE_FIELDS: readonly EditableField[] = ['title', 'essence', 'reason', 'expectedEffect', 'resources', 'confidence', 'confidenceReason', 'risks', 'nextAction']

export const FIELD_LABEL: Record<EditableField | 'kind' | 'scopeNote' | 'comment', string> = {
  kind: 'Вид',
  title: 'Название',
  essence: 'Суть',
  reason: 'Причина',
  expectedEffect: 'Ожидаемый результат',
  resources: 'Ресурсы',
  confidence: 'Уверенность',
  confidenceReason: 'Обоснование уверенности',
  risks: 'Риски',
  nextAction: 'Следующее действие',
  scopeNote: 'Область применимости',
  comment: 'Комментарий',
}

export type FormMode = 'verify' | 'reject' | 'edit' | 'create'
export type FormValues = Record<EditableField | 'kind' | 'scopeNote' | 'comment', string>
export type FormErrors = Partial<Record<keyof FormValues, string>>

export interface RecForm {
  mode: FormMode
  /** null for «Добавить свою». */
  recId: string | null
  values: FormValues
  errors: FormErrors
}

const EMPTY_VALUES: FormValues = {
  kind: 'action', title: '', essence: '', reason: '', expectedEffect: '', resources: '', confidence: 'medium', confidenceReason: '', risks: '', nextAction: '', scopeNote: '', comment: '',
}

function valuesOf(rec: Recommendation): FormValues {
  return {
    ...EMPTY_VALUES,
    kind: rec.kind,
    title: rec.title,
    essence: rec.essence,
    reason: rec.reason,
    expectedEffect: rec.expectedEffect ?? '',
    resources: rec.resources ?? '',
    confidence: rec.confidence,
    confidenceReason: rec.confidenceReason ?? '',
    risks: rec.risks ?? '',
    nextAction: rec.nextAction ?? '',
  }
}

const tooLong = (v: string, max: number, label: string): string | undefined => (v.length > max ? `${label}: не длиннее ${max} символов` : undefined)

export function validateForm(form: RecForm): FormErrors {
  const v = form.values
  const e: FormErrors = {}
  if (form.mode === 'verify' || form.mode === 'create') {
    if (!v.scopeNote.trim()) e.scopeNote = 'Укажите область применимости: для какого плана и каких данных верна рекомендация'
    else e.scopeNote = tooLong(v.scopeNote, LIMITS.scope, FIELD_LABEL.scopeNote)
  }
  if (form.mode === 'reject' && !v.comment.trim()) e.comment = 'Напишите, почему рекомендация отклонена'
  if (v.comment) e.comment = e.comment ?? tooLong(v.comment, LIMITS.comment, FIELD_LABEL.comment)
  if (form.mode === 'edit' || form.mode === 'create') {
    if (!v.title.trim()) e.title = 'Название обязательно'
    else e.title = tooLong(v.title, LIMITS.title, FIELD_LABEL.title)
    if (!v.essence.trim()) e.essence = 'Опишите суть'
    if (!v.reason.trim()) e.reason = 'Опишите причину'
    for (const f of ['essence', 'reason', 'expectedEffect', 'resources', 'confidenceReason', 'risks', 'nextAction'] as const) {
      e[f] = e[f] ?? tooLong(v[f], LIMITS.text, FIELD_LABEL[f])
    }
  }
  for (const k of Object.keys(e) as Array<keyof FormValues>) if (!e[k]) delete e[k]
  return e
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null)

/** Only the fields the expert changed (the server makes a new pending version of them). */
export function editPatch(rec: Recommendation, v: FormValues): Partial<Pick<Recommendation, EditableField>> {
  const next: Pick<Recommendation, EditableField> = {
    title: v.title.trim(),
    essence: v.essence.trim(),
    reason: v.reason.trim(),
    expectedEffect: orNull(v.expectedEffect),
    resources: orNull(v.resources),
    confidence: (CONFIDENCES.includes(v.confidence as Recommendation['confidence']) ? v.confidence : rec.confidence) as Recommendation['confidence'],
    confidenceReason: orNull(v.confidenceReason),
    risks: orNull(v.risks),
    nextAction: orNull(v.nextAction),
  }
  const patch: Partial<Pick<Recommendation, EditableField>> = {}
  for (const f of EDITABLE_FIELDS) if (next[f] !== rec[f]) (patch as Record<string, unknown>)[f] = next[f]
  return patch
}

function draftOf(v: FormValues): Record<string, unknown> {
  return {
    kind: REC_KINDS.includes(v.kind as RecKind) ? v.kind : 'action',
    title: v.title.trim(),
    essence: v.essence.trim(),
    reason: v.reason.trim(),
    expectedEffect: orNull(v.expectedEffect),
    resources: orNull(v.resources),
    confidence: CONFIDENCES.includes(v.confidence as Recommendation['confidence']) ? v.confidence : 'medium',
    confidenceReason: orNull(v.confidenceReason),
    risks: orNull(v.risks),
    nextAction: orNull(v.nextAction),
    sourceRefs: [] as RecSourceRef[],
  }
}

// ── Controller ──────────────────────────────────────────────────────────

export type RecsBusy = 'generate' | 'rules' | 'create' | `verify:${string}` | `reject:${string}` | `edit:${string}`

export interface RecsPanelSnapshot {
  phase: 'loading' | 'ready' | 'error'
  loadError: string | null
  items: Recommendation[]
  busy: RecsBusy | null
  /** Russian text of an action that worked. */
  notice: string | null
  /** Warnings of the last AI generation (dropped items, too soon, budget…). */
  warnings: string[]
  /** The last failed action: the server's text and its status. */
  error: { message: string; status: number; field?: string } | null
  form: RecForm | null
}

export const INITIAL_RECS_SNAPSHOT: RecsPanelSnapshot = { phase: 'loading', loadError: null, items: [], busy: null, notice: null, warnings: [], error: null, form: null }

const FALLBACK: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  400: 'Сервер отклонил данные — проверьте поля',
  401: 'Сессия закончилась — войдите заново',
  403: 'Недостаточно прав или клиент вам не назначен',
  404: 'Рекомендация не найдена — обновите список',
  409: 'Рекомендацию уже проверили или изменили — обновите список',
  429: 'Слишком часто: генерация ИИ доступна не чаще 10 раз в час',
}

type CallResult = { ok: boolean; status: number; body: Record<string, unknown> | null }

export class RecommendationsController {
  private snap: RecsPanelSnapshot = INITIAL_RECS_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(
    private readonly userId: string,
    private readonly fetchFn: typeof fetch,
    /** For the default scope note: plan version id → its number, and the number to use when the rec has none. */
    private versions: { numbers: Record<string, number>; current: number | null } = { numbers: {}, current: null },
  ) {}

  private url(recId?: string): string {
    const base = `/api/giga-admin/users/${this.userId}/point-b/recommendations`
    return recId ? `${base}/${encodeURIComponent(recId)}` : base
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): RecsPanelSnapshot => this.snap

  private set(patch: Partial<RecsPanelSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  setVersions(v: { numbers: Record<string, number>; current: number | null }): void { this.versions = v }

  private async call(method: 'GET' | 'POST' | 'PATCH', url: string, json?: unknown): Promise<CallResult> {
    try {
      const res = await this.fetchFn(url, {
        method,
        credentials: 'include',
        cache: 'no-store',
        ...(json !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : {}),
      })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { ok: res.ok && body?.ok !== false, status: res.status, body }
    } catch {
      return { ok: false, status: 0, body: null }
    }
  }

  private toError(r: CallResult): { message: string; status: number; field?: string } {
    const text = typeof r.body?.error === 'string' && /[а-яё]/i.test(r.body.error) ? r.body.error : null
    const field = typeof r.body?.field === 'string' ? r.body.field : undefined
    return { message: text ?? FALLBACK[r.status] ?? `Ошибка сервера (${r.status})`, status: r.status, ...(field ? { field } : {}) }
  }

  async load(): Promise<void> {
    const my = ++this.seq
    if (this.snap.phase !== 'ready') this.set({ phase: 'loading', loadError: null })
    const r = await this.call('GET', this.url())
    if (my !== this.seq) return
    const items = r.ok ? parseRecommendationList(r.body) : null
    if (!items) {
      this.set({ phase: 'error', loadError: r.ok ? 'Не удалось прочитать рекомендации' : this.toError(r).message })
      return
    }
    this.set({ phase: 'ready', loadError: null, items })
  }

  dismissMessages(): void { this.set({ notice: null, error: null, warnings: [] }) }

  /** «Сгенерировать рекомендации ИИ»: drafts go to the review queue, never to the client. */
  async generate(): Promise<boolean> {
    if (this.snap.busy) return false
    this.set({ busy: 'generate', notice: null, error: null, warnings: [] })
    const r = await this.call('POST', this.url(), { action: 'generate_ai' })
    if (!r.ok) {
      this.set({ busy: null, error: this.toError(r) })
      return false
    }
    const data = isObj(r.body?.data) ? (r.body!.data as Record<string, unknown>) : {}
    const created = listOf(data.created ?? data.items, 'items').map(parseRecommendation).filter((x): x is Recommendation => !!x)
    const warnings = (Array.isArray(data.warnings) ? data.warnings : []).filter((w): w is string => typeof w === 'string' && !!w.trim()).map(warningText)
    this.set({
      busy: null,
      warnings,
      notice: created.length > 0 ? `Создано рекомендаций: ${created.length}. Они на проверке — клиент их пока не видит.` : 'Новых рекомендаций нет',
    })
    await this.load()
    return true
  }

  /** «Применить правила и инвайты»: the deterministic rules for this client (invites, at most per the limits). */
  async runRules(): Promise<boolean> {
    if (this.snap.busy) return false
    this.set({ busy: 'rules', notice: null, error: null, warnings: [] })
    const r = await this.call('POST', this.url(), { action: 'run_rules' })
    if (!r.ok) {
      this.set({ busy: null, error: this.toError(r) })
      return false
    }
    const data = isObj(r.body?.data) ? (r.body!.data as Record<string, unknown>) : {}
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    this.set({ busy: null, notice: `Правила применены: новых подсказок клиенту — ${n(data.created)}, пропущено (повтор, пауза или лимит) — ${n(data.skipped)}` })
    await this.load()
    return true
  }

  // ── forms ──

  openForm(mode: FormMode, recId: string | null = null): void {
    const rec = recId ? this.snap.items.find((r) => r.id === recId) ?? null : null
    if (mode !== 'create' && !rec) return
    const values: FormValues = rec ? valuesOf(rec) : { ...EMPTY_VALUES }
    if (mode === 'verify') values.scopeNote = defaultScopeNote(rec!, this.versions.numbers, this.versions.current)
    if (mode === 'create') values.scopeNote = defaultScopeNote({ versionId: null, createdAt: new Date().toISOString() }, {}, this.versions.current)
    this.set({ form: { mode, recId, values, errors: {} }, error: null, notice: null })
  }

  closeForm(): void { this.set({ form: null, error: null }) }

  setField(field: keyof FormValues, value: string): void {
    const f = this.snap.form
    if (!f) return
    const { [field]: _drop, ...errors } = f.errors
    void _drop
    this.set({ form: { ...f, values: { ...f.values, [field]: value }, errors }, error: null })
  }

  async submitForm(): Promise<boolean> {
    const f = this.snap.form
    if (!f || this.snap.busy) return false
    const errors = validateForm(f)
    if (Object.keys(errors).length) {
      this.set({ form: { ...f, errors } })
      return false
    }
    const v = f.values
    const rec = f.recId ? this.snap.items.find((r) => r.id === f.recId) ?? null : null
    let body: Record<string, unknown>
    let busy: RecsBusy
    if (f.mode === 'create') {
      busy = 'create'
      body = { action: 'create', draft: draftOf(v), scopeNote: v.scopeNote.trim(), ...(v.comment.trim() ? { comment: v.comment.trim() } : {}) }
    } else {
      if (!rec) return false
      busy = `${f.mode}:${rec.id}`
      if (f.mode === 'verify') body = { action: 'verify', scopeNote: v.scopeNote.trim(), ...(v.comment.trim() ? { comment: v.comment.trim() } : {}) }
      else if (f.mode === 'reject') body = { action: 'reject', comment: v.comment.trim() }
      else {
        const patch = editPatch(rec, v)
        if (Object.keys(patch).length === 0) {
          this.set({ form: { ...f, errors: { title: 'Ничего не изменено' } } })
          return false
        }
        body = { action: 'edit', patch }
      }
    }
    this.set({ busy, error: null, notice: null })
    const r = await this.call(f.mode === 'create' ? 'POST' : 'PATCH', f.mode === 'create' ? this.url() : this.url(rec!.id), body)
    if (!r.ok) {
      const err = this.toError(r)
      // A field the server named (profanity, length) is shown next to that field.
      const field = err.field && err.field in v ? (err.field as keyof FormValues) : null
      this.set({ busy: null, error: err, form: field ? { ...f, errors: { ...f.errors, [field]: err.message } } : f })
      return false
    }
    const saved = parseRecommendation(isObj(r.body?.data) ? r.body!.data : null)
    const notice = f.mode === 'verify' ? 'Рекомендация подтверждена — клиент увидит её с вашим именем и областью применимости'
      : f.mode === 'reject' ? 'Рекомендация отклонена — клиент её не увидит'
        : f.mode === 'create' ? 'Ваша рекомендация добавлена как проверенная вами'
          : `Создана версия ${saved?.recVersion ?? (rec ? rec.recVersion + 1 : 2)} — она снова на проверке, прежняя помечена «требует обновления»`
    this.set({ busy: null, form: null, notice })
    await this.load()
    return true
  }
}
