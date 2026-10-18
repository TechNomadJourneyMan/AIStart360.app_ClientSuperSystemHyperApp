/**
 * components/giga-panel/pages/pointBQueueModel.ts — the pure part of the admin queue
 * «Точка Б — на одобрении» (plan Phase 1 Task 10): reads the answer of
 * GET /api/giga-admin/point-b/queue and words the waiting time.
 *
 * Contract used (plan Task 6): `{ ok, data: Array<item> }` (or `data.items`) with, per
 * in_review version, the client name, the company, the wait age and the author. Field
 * names are read tolerantly (camelCase or snake_case); a missing age is computed from
 * `submittedAt`.
 */

export interface QueueRow {
  versionId: string
  version: number
  userId: string
  clientName: string
  company: string | null
  authorName: string | null
  submittedAt: string | null
  waitingDays: number
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

const DAY_MS = 86_400_000

export function parseQueue(body: unknown, now: number = Date.now()): QueueRow[] {
  const data = isObj(body) ? body.data : undefined
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? data.items : []
  const rows: QueueRow[] = []
  for (const it of list) {
    if (!isObj(it)) continue
    const versionId = str(pick(it, 'versionId', 'version_id', 'id'))
    const userId = str(pick(it, 'userId', 'user_id'))
    if (!versionId || !userId) continue
    const submittedAt = str(pick(it, 'submittedAt', 'submitted_at'))
    const given = num(pick(it, 'waitingDays', 'waiting_days'))
    const computed = submittedAt && !Number.isNaN(Date.parse(submittedAt)) ? Math.max(0, Math.floor((now - Date.parse(submittedAt)) / DAY_MS)) : 0
    rows.push({
      versionId,
      version: num(pick(it, 'version', 'versionNumber', 'version_number')) ?? 0,
      userId,
      clientName: str(pick(it, 'clientName', 'client_name', 'name')) ?? 'Без имени',
      company: str(pick(it, 'companyName', 'company_name', 'company')),
      authorName: str(pick(it, 'authorName', 'author_name')),
      submittedAt,
      waitingDays: given ?? computed,
    })
  }
  // The longest wait first.
  return rows.sort((a, b) => b.waitingDays - a.waitingDays)
}

/** «сегодня», «1 день», «3 дня», «12 дней». */
export function waitingLabel(days: number): string {
  const d = Math.max(0, Math.floor(days))
  if (d === 0) return 'сегодня'
  const last = d % 10
  const tail = d % 100
  const word = tail >= 11 && tail <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней'
  return `${d} ${word}`
}

/** Link to the client's Point B tab in User 360 (base: '/admin-giga-panel' or '/super-expert'). */
export function userPointBHref(base: string, userId: string): string {
  return `${base}/users/${userId}?tab=point-b`
}

/** A wait of a week or more is flagged (the spec's reminder to the approvers is at 7 days). */
export const QUEUE_STALE_DAYS = 7
