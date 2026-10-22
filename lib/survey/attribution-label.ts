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
import type { AnswerAuthorRole } from './attribution'

export interface AnswerAttribution {
  updatedBy: string | null
  updatedByRole: AnswerAuthorRole | null
  /** ISO timestamp. */
  updatedAt: string | null
  /** Name of an expert / admin (profiles.full_name or email); null otherwise. */
  updatedByName: string | null
  /** Derived from an old answer (no author columns written). */
  legacy?: boolean
}

export interface AttributionViewer {
  /** The person looking at the questionnaire. */
  viewerId?: string | null
  /** The viewer owns these answers (client cabinet): the owner is «вы». */
  viewerIsOwner?: boolean
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

const withName = (base: string, name: string | null) => (name && name.trim() ? `${base} ${name.trim()}` : base)

/** The text of the author line, or null when the author is unknown (then no line is shown). */
export function formatAttribution(a: AnswerAttribution | null | undefined, viewer: AttributionViewer = {}): string | null {
  if (!a || !a.updatedByRole) return null
  const isViewer = !!viewer.viewerId && a.updatedBy === viewer.viewerId
  let who: string
  switch (a.updatedByRole) {
    case 'user':
      who = viewer.viewerIsOwner || isViewer ? 'Заполнил: вы' : withName('Заполнил пользователь', a.updatedByName)
      break
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
