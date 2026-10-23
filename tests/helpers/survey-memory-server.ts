/**
 * An in-memory stand-in for the questionnaire endpoints the browser uses
 * (GET/POST /api/v1/onboarding/survey, GET/POST /api/v1/onboarding/company):
 * stores answer envelopes and their author line like the real route, so the
 * answers controller and the mode switch are tested without network or DB.
 */
import type { SurveyFetch } from '@/lib/survey/answers-controller'
import { fromAnswerEnvelope } from '@/lib/survey/answer-value'

export interface MemoryCall { method: string; url: string; body: Record<string, unknown> | null }

export class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  get size() { return this.m.size }
}

export class MemorySurveyServer {
  /** question_key → stored envelope. */
  rows = new Map<string, { answer: Record<string, unknown>; updatedAt: string; via: string | null }>()
  company: { id: string; name: string; [k: string]: unknown } | null = null
  calls: MemoryCall[] = []
  /** Server clock (ms). Every write advances it by a second. */
  clock = Date.UTC(2026, 9, 23, 9, 0)
  /** Make the next POST of the survey fail with this status. */
  failNext: number | null = null
  /** Hold POST responses until release() (in-flight edits). */
  private held: Array<() => void> | null = null

  hold() { this.held = [] }
  release() { const h = this.held ?? []; this.held = null; for (const r of h) r() }

  private tick(): string { this.clock += 1000; return new Date(this.clock).toISOString() }

  /** A write made elsewhere (another mode, an expert). */
  writeElsewhere(key: string, value: unknown, via = 'chat') {
    this.rows.set(key, { answer: { value }, updatedAt: this.tick(), via })
  }

  answers(): Record<string, unknown> {
    return Object.fromEntries([...this.rows].map(([k, r]) => [k, fromAnswerEnvelope(r.answer)]))
  }

  fetch: SurveyFetch = async (url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    this.calls.push({ method, url, body })
    const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data })
    if (url === '/api/v1/onboarding/survey' && method === 'GET') {
      const answers: Record<string, unknown> = {}
      const attribution: Record<string, unknown> = {}
      for (const [k, r] of this.rows) {
        answers[k] = fromAnswerEnvelope(r.answer)
        attribution[k] = { updatedBy: 'u', updatedByRole: 'user', updatedAt: r.updatedAt, updatedByName: null, ...(r.via ? { updatedVia: r.via } : {}) }
      }
      return json(200, { ok: true, data: { answers, attribution } })
    }
    if (url === '/api/v1/onboarding/survey' && method === 'POST') {
      if (this.held) await new Promise<void>((r) => this.held!.push(r))
      if (this.failNext) { const s = this.failNext; this.failNext = null; return json(s, { ok: false, error: 'boom' }) }
      const at = this.tick()
      const attribution: Record<string, unknown> = {}
      for (const [k, env] of Object.entries((body?.answers ?? {}) as Record<string, Record<string, unknown>>)) {
        this.rows.set(k, { answer: env, updatedAt: at, via: String(body?.via ?? 'full') })
        attribution[k] = { updatedBy: 'u', updatedByRole: 'user', updatedAt: at, updatedByName: null, updatedVia: body?.via ?? 'full' }
      }
      return json(200, { ok: true, data: { saved: Object.keys(attribution).length, attribution } })
    }
    if (url === '/api/v1/onboarding/company' && method === 'GET') {
      return json(200, this.company ? { ok: true, data: this.company } : { ok: true, data: null })
    }
    if (url === '/api/v1/onboarding/company' && method === 'POST') {
      this.company = { id: this.company?.id ?? 'c-1', ...(body as Record<string, unknown>), name: String(body?.name ?? '') }
      return json(200, { ok: true, data: { id: this.company.id } })
    }
    return json(404, { ok: false, error: 'not found' })
  }
}
