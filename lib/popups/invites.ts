/**
 * lib/popups/invites.ts — Point B invites (pb_invites, migration 129) as pop-up candidates of the cabinet layer
 * (spec §12.2; plan Ф6a, Task 6). Server side only.
 *
 *   candidates   the user's invites that were NOT shown yet: status new, or a snooze that is over; not expired.
 *                insight → kind 'insight' (badge «Подсказка платформы»), an invite of a verified recommendation →
 *                kind 'recommendation' with the reviewer's name / specialty / date for the badge «Проверено экспертом».
 *                display comes from the invite (modal = critical, e.g. a cash gap in the first months).
 *   shownToday   invites the user already saw / closed / snoozed / opened during the last 24 hours — the daily
 *                card budget of the layer (and the modal budget for modal ones).
 * Order (spec §12.2): critical insight (20) → recommendation (30) → insight (40), + the invite's own priority.
 *
 * Two or three short indexed queries. A missing table (migration 129 not applied) → nothing, never an error.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanRefs } from '@/lib/point-b/recs/store'
import type { PopupCandidate } from './types'

const DAY_MS = 86_400_000
const LIMIT = 20

interface InviteRow {
  id: string
  kind: 'insight' | 'recommendation'
  title: string
  body: string | null
  href: string | null
  why: string | null
  source_refs: unknown
  priority: number | null
  display: 'card' | 'modal'
  status: string
  snoozed_until: string | null
  expires_at: string | null
  source_rec_id: string | null
  created_at: string
}

export interface InviteCandidates {
  candidates: PopupCandidate[]
  shownToday: { cards: number; modals: number }
}

const NONE: InviteCandidates = { candidates: [], shownToday: { cards: 0, modals: 0 } }
const isMissing = (code: unknown): boolean => code === '42P01' || code === 'PGRST205'

function basePriority(r: Pick<InviteRow, 'kind' | 'display'>): number {
  if (r.kind === 'recommendation') return 30
  return r.display === 'modal' ? 20 : 40
}

export async function loadInviteCandidates(sb: SupabaseClient, userId: string, now: Date): Promise<InviteCandidates> {
  const { data, error } = await sb.from('pb_invites')
    .select('id, kind, title, body, href, why, source_refs, priority, display, status, snoozed_until, expires_at, source_rec_id, created_at')
    .eq('user_id', userId).in('status', ['new', 'snoozed']).order('created_at', { ascending: false }).limit(LIMIT)
  if (error) {
    if (isMissing((error as { code?: string }).code)) return NONE
    throw new Error(`popups: read invites: ${(error as { code?: string }).code ?? ''}`.trim())
  }
  const t = now.getTime()
  const rows = ((data ?? []) as InviteRow[]).filter((r) =>
    !(r.expires_at && Date.parse(r.expires_at) <= t) && !(r.status === 'snoozed' && r.snoozed_until && Date.parse(r.snoozed_until) > t))

  // The reviewer of a verified recommendation (for the badge «Проверено экспертом · имя»).
  const recIds = [...new Set(rows.filter((r) => r.kind === 'recommendation' && r.source_rec_id).map((r) => r.source_rec_id as string))]
  const reviewers = new Map<string, { name: string | null; specialty: string | null; reviewedAt: string | null }>()
  if (recIds.length) {
    const recs = await sb.from('pb_recommendations').select('id, reviewer_name, reviewer_specialty, reviewed_at, status').in('id', recIds)
    for (const r of (recs.data ?? []) as Array<{ id: string; reviewer_name: string | null; reviewer_specialty: string | null; reviewed_at: string | null; status: string }>) {
      if (r.status === 'expert_verified') reviewers.set(r.id, { name: r.reviewer_name, specialty: r.reviewer_specialty, reviewedAt: r.reviewed_at })
    }
  }

  const candidates: PopupCandidate[] = []
  for (const r of rows) {
    const rev = r.source_rec_id ? reviewers.get(r.source_rec_id) : undefined
    // A recommendation invite whose recommendation is no longer verified (edited, stale) is not pushed.
    if (r.kind === 'recommendation' && !rev) continue
    candidates.push({
      id: r.id,
      kind: r.kind === 'recommendation' ? 'recommendation' : 'insight',
      display: r.display === 'modal' ? 'modal' : 'card',
      priority: basePriority(r) + Math.max(0, Math.min(9, r.priority ?? 5)),
      title: r.title,
      body: r.body ?? '',
      authorName: rev?.name?.trim() || null,
      authorSpecialty: rev?.specialty?.trim() || null,
      createdAt: r.created_at,
      href: r.href,
      important: false,
      canReply: false,
      why: r.why ?? '',
      sourceRefs: cleanRefs(r.source_refs),
      ...(rev ? { reviewedAt: rev.reviewedAt } : {}),
    })
  }

  // What the layer already showed today: invites the user touched during the last 24 hours.
  const since = new Date(t - DAY_MS).toISOString()
  const shown = await sb.from('pb_invites').select('id, display').eq('user_id', userId)
    .in('status', ['seen', 'dismissed', 'snoozed', 'acted']).gt('updated_at', since).limit(50)
  const touched = (shown.data ?? []) as Array<{ display: string }>
  return {
    candidates,
    shownToday: { cards: touched.length, modals: touched.filter((x) => x.display === 'modal').length },
  }
}
