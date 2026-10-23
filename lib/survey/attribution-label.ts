/**
 * lib/survey/attribution-label.ts — the line under a questionnaire field:
 * «Заполнил: вы · 22.10.2026», «Изменил эксперт Иван Петров · 22.10.2026»,
 * «Заполнил ИИ (из документов) · …» (PO item 4.2). No author → no line at all
 * (survey audit 2026-10-22, MVP item 9: 100 % of the old answers have no author,
 * and «Автор не записан» under every field was noise).
 *
 * Pure and browser-safe. The server sends one `AnswerAttribution` per answer
 * (GET /api/v1/onboarding/survey, GIGA survey tab); old answers without an
 * author arrive with `updatedByRole: 'ai'` and `legacy: true` when the answer
 * carried a `source` (filled from documents), otherwise with no role.
 */
import type { AnswerAuthorRole, AnswerVia } from './attribution'

export interface AnswerAttribution {
  updatedBy: string | null
  updatedByRole: AnswerAuthorRole | null
  /** ISO timestamp. */
  updatedAt: string | null
  /** Name of an expert / admin (profiles.full_name or email); null otherwise. */
  updatedByName: string | null
  /** Derived from an old answer (no author columns written). */
  legacy?: boolean
  /** How the answer was given (migration 134); absent when unknown. */
  updatedVia?: AnswerVia
}

export interface AttributionViewer {
  /** The person looking at the questionnaire. */
  viewerId?: string | null
  /** The viewer owns these answers (client cabinet): the owner is «вы». */
  viewerIsOwner?: boolean
  /** Staff views: the client's name for «Заполнил пользователь Имя». */
  ownerName?: string | null
}

/** 22.10.2026 (Asia/Almaty is the product's zone; the date is what matters). */
export function formatAttributionDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

/**
 * The path in brackets after «Заполнил: вы» (spec §5.4): the express flow is
 * «быстрый старт» to the owner and «экспресс» to staff; the AI chat and the
 * field «Помощник» are «через ИИ-помощника». The full questionnaire adds nothing.
 */
export function viaPhrase(via: AnswerVia | null | undefined, ownerView: boolean): string | null {
  if (via === 'express') return ownerView ? 'быстрый старт' : 'экспресс'
  if (via === 'chat' || via === 'helper') return 'через ИИ-помощника'
  return null
}

const withName = (base: string, name: string | null) => (name && name.trim() ? `${base} ${name.trim()}` : base)

/** The text of the author line, or null when the author is unknown (then no line is shown). */
export function formatAttribution(a: AnswerAttribution | null | undefined, viewer: AttributionViewer = {}): string | null {
  if (!a || !a.updatedByRole) return null
  const isViewer = !!viewer.viewerId && a.updatedBy === viewer.viewerId
  let who: string
  switch (a.updatedByRole) {
    case 'user': {
      const own = viewer.viewerIsOwner || isViewer
      const base = own ? 'Заполнил: вы' : withName('Заполнил пользователь', a.updatedByName ?? viewer.ownerName ?? null)
      const path = viaPhrase(a.updatedVia, own)
      who = path ? `${base} (${path})` : base
      break
    }
    case 'expert':
      who = isViewer ? 'Изменили вы (эксперт)' : withName('Изменил эксперт', a.updatedByName)
      break
    case 'admin':
      who = isViewer ? 'Изменили вы (админ)' : withName('Изменил админ', a.updatedByName)
      break
    case 'ai':
      who = 'Заполнил ИИ (из документов)'
      break
    case 'system':
      who = 'Заполнено системой'
      break
    default:
      return null
  }
  const date = formatAttributionDate(a.updatedAt)
  return date ? `${who} · ${date}` : who
}

// ─── «Кто заполнял» — the summary over all answers (spec §5.4) ────────────────

export interface AuthorSummary {
  /** Answered keys counted. */
  total: number
  /** The owner (role user). */
  owner: number
  /** …of which through the AI helper / chat. */
  ownerViaAssistant: number
  /** …of which in the express flow. */
  ownerViaExpress: number
  /** Accepted from documents (role ai). */
  documents: number
  /** Staff authors: one entry per person (or per role when the name is unknown). */
  staff: Array<{ role: 'expert' | 'admin'; id: string | null; name: string | null; count: number }>
  system: number
  /** No author recorded (old answers). */
  unknown: number
}

export function summarizeAuthors(
  keys: readonly string[],
  attribution: Readonly<Record<string, AnswerAttribution | undefined>>,
): AuthorSummary {
  const out: AuthorSummary = { total: keys.length, owner: 0, ownerViaAssistant: 0, ownerViaExpress: 0, documents: 0, staff: [], system: 0, unknown: 0 }
  const staff = new Map<string, AuthorSummary['staff'][number]>()
  for (const key of keys) {
    const a = attribution[key]
    switch (a?.updatedByRole) {
      case 'user':
        out.owner += 1
        if (a.updatedVia === 'chat' || a.updatedVia === 'helper') out.ownerViaAssistant += 1
        if (a.updatedVia === 'express') out.ownerViaExpress += 1
        break
      case 'ai':
        out.documents += 1
        break
      case 'expert':
      case 'admin': {
        const id = a.updatedBy ?? null
        const k = `${a.updatedByRole}|${id ?? ''}`
        const entry = staff.get(k) ?? { role: a.updatedByRole, id, name: a.updatedByName ?? null, count: 0 }
        entry.count += 1
        staff.set(k, entry)
        break
      }
      case 'system':
        out.system += 1
        break
      default:
        out.unknown += 1
    }
  }
  out.staff = Array.from(staff.values()).sort((x, y) => y.count - x.count)
  return out
}

/**
 * «Ответов 96: вы — 70 (из них через ИИ-помощника — 18), из документов — 6,
 * эксперт Иван Петров — 4, без автора (старые) — 16». Staff views name the
 * owner («пользователь Имя»).
 */
export function formatAuthorSummary(s: AuthorSummary, viewer: AttributionViewer = {}): string {
  if (s.total === 0) return 'Ответов пока нет'
  const parts: string[] = []
  if (s.owner) {
    const who = viewer.viewerIsOwner ? 'вы' : withName('пользователь', viewer.ownerName ?? null)
    const sub: string[] = []
    if (s.ownerViaExpress) sub.push(`в быстром старте — ${s.ownerViaExpress}`)
    if (s.ownerViaAssistant) sub.push(`через ИИ-помощника — ${s.ownerViaAssistant}`)
    parts.push(`${who} — ${s.owner}${sub.length ? ` (из них ${sub.join(', ')})` : ''}`)
  }
  if (s.documents) parts.push(`из документов — ${s.documents}`)
  for (const st of s.staff) {
    const isViewer = !!viewer.viewerId && st.id === viewer.viewerId
    const who = isViewer ? 'вы (эксперт)' : withName(st.role === 'expert' ? 'эксперт' : 'админ', st.name)
    parts.push(`${who} — ${st.count}`)
  }
  if (s.system) parts.push(`система — ${s.system}`)
  if (s.unknown) parts.push(`без автора (старые) — ${s.unknown}`)
  return `Ответов ${s.total}: ${parts.join(', ')}`
}
