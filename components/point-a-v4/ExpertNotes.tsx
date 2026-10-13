'use client'

/**
 * The expert's notes on Point A (public.point_a_comments, spec §7): the client
 * sees them signed. Overall notes in their own card; block / metric notes on
 * the block cards and in «Подробнее».
 */
import type { PointAComment } from '@/lib/point-a/v4/state'
import type { PointAPageState } from '@/hooks/usePointAState'
import { BLOCK_KEYS, BLOCK_LIBRARY, isBlockKey } from '@/lib/point-a/v4/config'
import { getMetricById } from '@/lib/metrics/registry'
import { CARD, Icon, SectionTitle } from './ui'

const ROLE_RU: Record<string, string> = { super_expert: 'эксперт', expert: 'эксперт', admin: 'администратор', super_admin: 'администратор' }

export function ExpertComment({ c, metricLabel }: { c: PointAComment; metricLabel?: string | null }) {
  const about = c.targetKind === 'block' && isBlockKey(c.targetKey) ? BLOCK_LIBRARY[c.targetKey].title : metricLabel ?? null
  return (
    <li className="rounded-xl border border-sky-300/15 bg-sky-300/[0.04] p-3">
      <p className="whitespace-pre-wrap text-sm text-on-surface">{c.body}</p>
      <p className="mt-1.5 text-[11px] text-on-surface-variant" suppressHydrationWarning>
        {c.authorName ?? 'Эксперт'}{c.authorRole && ROLE_RU[c.authorRole] ? ` · ${ROLE_RU[c.authorRole]}` : ''} · {new Date(c.createdAt).toLocaleDateString('ru-RU')}
        {about ? ` · о «${about}»` : ''}
      </p>
    </li>
  )
}

export function ExpertNotes({ state }: { state: PointAPageState }) {
  // Overall notes, and notes on metrics no block shows (they would be lost).
  const inBlocks = new Set(BLOCK_KEYS.flatMap((k) => BLOCK_LIBRARY[k].metrics))
  const overall = (state.comments ?? []).filter((c) => c.targetKind === 'overall' || (c.targetKind === 'metric' && !!c.targetKey && !inBlocks.has(c.targetKey)))
  if (!overall.length) return null
  return (
    <section className={CARD} aria-labelledby="pa-expert">
      <SectionTitle icon="support_agent"><span id="pa-expert">Комментарий эксперта</span></SectionTitle>
      <ul className="space-y-2">{overall.slice(0, 3).map((c) => <ExpertComment key={c.id} c={c} metricLabel={c.targetKind === 'metric' && c.targetKey ? getMetricById(c.targetKey)?.label ?? c.targetKey : null} />)}</ul>
      {overall.length > 3 && <p className="mt-2 text-[11px] text-on-surface-variant"><Icon name="more_horiz" className="text-[14px] align-middle" /> ещё {overall.length - 3}</p>}
    </section>
  )
}
