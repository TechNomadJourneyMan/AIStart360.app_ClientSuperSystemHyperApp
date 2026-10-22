/**
 * components/point-b/recsModel.ts — display logic of the client «Рекомендации» tab, the invite cards and the
 * «Следующий шаг» card of the «Обзор» (plan Ф6a Task 7, spec §12, §12.1, §15.2), free of React and of the DOM.
 *
 * It reads the additive fields of `GET /api/v1/point-b/state` (plan Ф6a Task 6):
 *   data.recommendations: { verified: ClientRecommendationView[]; pendingCount: number }
 *   data.invites: InviteView[]
 *   data.nextStep: { title: string; action: string | null; recId: string | null } | null
 * The parser is tolerant (a field the server did not send is an empty value) and STRICT about visibility: only
 * items whose `state` is 'verified' or 'stale' are ever kept — the client never sees the text of a recommendation
 * that waits for the expert or was rejected, only the count of the pending ones.
 */
import type { ClientRecommendationView, RecKind, RecSourceRef } from '@/lib/point-b/recs/types'
import type { InviteView } from '@/lib/point-b/invites/types'
import { fmtLongDate, isTabKey, type PointBTabKey } from './overviewModel'

// ── State ───────────────────────────────────────────────────────────────

export interface PointBRecsState { verified: ClientRecommendationView[]; pendingCount: number }
export interface PointBNextStep { title: string; action: string | null; recId: string | null }

export const EMPTY_RECS: PointBRecsState = { verified: [], pendingCount: 0 }

/** Visible invite cards on a page (spec §12.1). */
export const MAX_INVITE_CARDS = 3

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

const REC_KINDS: readonly RecKind[] = ['lever', 'risk', 'action', 'contradiction', 'constraint']
const CONFIDENCES = ['low', 'medium', 'high'] as const
const REF_TYPES: ReadonlyArray<RecSourceRef['type']> = ['metric', 'model', 'snapshot', 'check', 'scenario', 'finmodel', 'goal']

export function parseSourceRefs(v: unknown): RecSourceRef[] {
  return (Array.isArray(v) ? v : []).filter(isObj).flatMap((r) => {
    const label = str(r.label)
    if (!label || !REF_TYPES.includes(r.type as RecSourceRef['type'])) return []
    return [{ type: r.type as RecSourceRef['type'], ref: str(r.ref) ?? '', label }]
  })
}

function toRecView(v: unknown): ClientRecommendationView | null {
  // Only what the expert has verified (or verified once and the data moved on). Anything else is dropped,
  // whatever the server sent: a pending or rejected text must never reach the client's screen.
  if (!isObj(v) || (v.state !== 'verified' && v.state !== 'stale')) return null
  const id = str(v.id)
  const title = str(v.title)
  if (!id || !title) return null
  return {
    id,
    kind: REC_KINDS.includes(v.kind as RecKind) ? (v.kind as RecKind) : 'action',
    title,
    essence: str(v.essence) ?? '',
    reason: str(v.reason) ?? '',
    expectedEffect: str(v.expectedEffect),
    resources: str(v.resources),
    confidence: CONFIDENCES.includes(v.confidence as never) ? (v.confidence as ClientRecommendationView['confidence']) : 'medium',
    confidenceReason: str(v.confidenceReason),
    risks: str(v.risks),
    nextAction: str(v.nextAction),
    sourceRefs: parseSourceRefs(v.sourceRefs),
    state: v.state,
    reviewerName: str(v.reviewerName),
    reviewerSpecialty: str(v.reviewerSpecialty),
    reviewedAt: str(v.reviewedAt),
    scopeNote: str(v.scopeNote),
  }
}

/** Absent → null (the server did not say: the tab shows the empty state). */
export function parseRecommendations(v: unknown): PointBRecsState | null {
  if (!isObj(v)) return null
  const verified = (Array.isArray(v.verified) ? v.verified : []).map(toRecView).filter((r): r is ClientRecommendationView => !!r)
  const n = typeof v.pendingCount === 'number' && Number.isFinite(v.pendingCount) ? Math.max(0, Math.floor(v.pendingCount)) : 0
  return { verified, pendingCount: n }
}

export function parseInvites(v: unknown): InviteView[] {
  return (Array.isArray(v) ? v : []).filter(isObj).flatMap((i): InviteView[] => {
    const id = str(i.id)
    const title = str(i.title)
    if (!id || !title) return []
    return [{
      id,
      kind: i.kind === 'recommendation' ? 'recommendation' : 'insight',
      title,
      body: str(i.body) ?? '',
      href: str(i.href),
      why: str(i.why) ?? '',
      sourceRefs: parseSourceRefs(i.sourceRefs),
      display: i.display === 'modal' ? 'modal' : 'card',
      createdAt: str(i.createdAt) ?? '',
    }]
  }).slice(0, MAX_INVITE_CARDS)
}

export function parseNextStep(v: unknown): PointBNextStep | null {
  if (!isObj(v)) return null
  const title = str(v.title)
  return title ? { title, action: str(v.action), recId: str(v.recId) } : null
}

export interface PointBRecsFields { recommendations: PointBRecsState | null; invites: InviteView[]; nextStep: PointBNextStep | null }

/** The Ф6a fields of the state answer; a missing field (migration 129 not applied, older server) is empty. */
export function parseRecsFromBody(body: unknown): PointBRecsFields {
  const d = isObj(body) && isObj(body.data) ? body.data : {}
  return { recommendations: parseRecommendations(d.recommendations), invites: parseInvites(d.invites), nextStep: parseNextStep(d.nextStep) }
}

// ── Labels ──────────────────────────────────────────────────────────────

export const RECS_HONEST_TEXT = 'Рекомендации ИИ показываются только после проверки экспертом'
export const RECS_EMPTY_PREPARING = 'Эксперт готовит рекомендации'
export const RECS_EMPTY_NONE = 'Пока нет проверенных рекомендаций'
export const STALE_LABEL = 'Требует обновления'
export const INSIGHT_BADGE = 'Подсказка платформы · не проверена экспертом'
export const WHY_LABEL = 'Почему вы это видите'

export const REC_KIND_LABEL: Record<RecKind, string> = {
  lever: 'Рычаг роста',
  risk: 'Риск',
  action: 'Действие',
  contradiction: 'Противоречие в плане',
  constraint: 'Ограничивающий фактор',
}

export const CONFIDENCE_LABEL: Record<ClientRecommendationView['confidence'], string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
}

export const SOURCE_TYPE_LABEL: Record<RecSourceRef['type'], string> = {
  metric: 'Показатель',
  model: 'Расчёт модели',
  snapshot: 'Снимок Точки А',
  check: 'Проверка',
  scenario: 'Сценарий',
  finmodel: 'Финмодель',
  goal: 'Цель',
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «2 рекомендации на проверке у эксперта»; 0 → null (nothing to say). */
export function pendingText(n: number): string | null {
  if (!(n > 0)) return null
  return `${n} ${plural(n, 'рекомендация', 'рекомендации', 'рекомендаций')} на проверке у эксперта`
}

/** «Проверено экспертом · Анна Ким · эксперт по продажам · 16 октября 2026 г.» — only the parts that are known. */
export function reviewedBadge(r: Pick<ClientRecommendationView, 'reviewerName' | 'reviewerSpecialty' | 'reviewedAt'>): string {
  return ['Проверено экспертом', r.reviewerName, r.reviewerSpecialty, fmtLongDate(r.reviewedAt)].filter(Boolean).join(' · ')
}

/** The rows of a recommendation card (empty fields are left out). */
export function recRows(r: ClientRecommendationView): Array<{ key: string; label: string; value: string }> {
  const confidence = `${CONFIDENCE_LABEL[r.confidence]}${r.confidenceReason ? ` — ${r.confidenceReason}` : ''}`
  const rows: Array<[string, string, string | null]> = [
    ['essence', 'Суть', r.essence || null],
    ['reason', 'Причина', r.reason || null],
    ['expectedEffect', 'Ожидаемый результат', r.expectedEffect],
    ['resources', 'Ресурсы', r.resources],
    ['confidence', 'Уверенность', confidence],
    ['risks', 'Риски', r.risks],
    ['nextAction', 'Следующее действие', r.nextAction],
  ]
  return rows.filter((x): x is [string, string, string] => !!x[2]).map(([key, label, value]) => ({ key, label, value }))
}

/** Verified first, then the stale ones (greyed); the server order inside each group is kept. */
export function orderedRecs(recs: PointBRecsState): ClientRecommendationView[] {
  return [...recs.verified.filter((r) => r.state === 'verified'), ...recs.verified.filter((r) => r.state === 'stale')]
}

export type RecsMode = 'loading' | 'error' | 'preparing' | 'none' | 'ready'

/** The empty states: «Эксперт готовит рекомендации» while some wait for the check, else «Пока нет проверенных». */
export function recsMode(snap: { phase: string; recommendations?: PointBRecsState | null }): RecsMode {
  if (snap.phase === 'loading') return 'loading'
  if (snap.phase === 'error' || snap.phase === 'locked') return 'error'
  const recs = snap.recommendations ?? EMPTY_RECS
  if (recs.verified.length > 0) return 'ready'
  return recs.pendingCount > 0 ? 'preparing' : 'none'
}

// ── Where a card leads ──────────────────────────────────────────────────

export type CardTarget = { tab: PointBTabKey } | { href: string }

const POINT_B_PATH = /^\/(?:client\/)?point-b\/?(?:[?#].*)?$/

/**
 * A deep link into this page (`/client/point-b?tab=whatif`) switches the tab in place; any other link
 * (`/client/messages`) is followed. Only same-site paths are accepted.
 */
export function linkTarget(href: string | null): CardTarget | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null
  if (POINT_B_PATH.test(href)) {
    const m = /[?&#]tab=([a-z]+)/.exec(href)
    const tab = m?.[1]
    return { tab: isTabKey(tab) ? tab : 'overview' }
  }
  return { href }
}

/**
 * «Следующий шаг»: from a verified recommendation → the «Рекомендации» tab; otherwise it is the nearest task of the
 * strategy → «Стратегия». An `action` that is itself a tab key or a same-site link is honoured as the target.
 */
export function nextStepTarget(step: PointBNextStep): CardTarget {
  if (step.recId) return { tab: 'recs' }
  if (isTabKey(step.action)) return { tab: step.action }
  const link = linkTarget(step.action)
  return link ?? { tab: 'strategy' }
}

/** The descriptive line under the title (an `action` used as a target is not shown as text). */
export function nextStepText(step: PointBNextStep): string | null {
  if (!step.action || isTabKey(step.action) || linkTarget(step.action)) return null
  return step.action
}

export const TAB_BUTTON_LABEL: Partial<Record<PointBTabKey, string>> = {
  recs: 'Открыть рекомендацию',
  strategy: 'Открыть стратегию',
  roadmap: 'Открыть дорожную карту',
  scenarios: 'Смотреть сценарии',
  whatif: 'Посчитать в «Что если»',
  finmodel: 'Заполнить финмодель',
  history: 'Открыть план-факт',
}

export function targetLabel(t: CardTarget): string {
  return 'tab' in t ? TAB_BUTTON_LABEL[t.tab] ?? 'Открыть' : 'Открыть'
}
