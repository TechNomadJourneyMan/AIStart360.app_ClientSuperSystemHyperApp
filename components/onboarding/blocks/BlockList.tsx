'use client'

import Link from 'next/link'
import { SURVEY_BLOCKS } from '@/lib/survey/questions'
import { blockProgress, blockProgressText, type RecommendedBlock } from '@/lib/survey/blocks'

/**
 * The 15 deepening blocks (spec 2026-10-23 §7.4–7.5): all open, no locks;
 * the three recommended ones first and marked; each with time, «зачем» and
 * its progress.
 */
export function BlockList({ answers, recommended }: { answers: Readonly<Record<string, unknown>>; recommended: readonly RecommendedBlock[] }) {
  const rec = new Set(recommended.map((r) => r.block.id))
  const ordered = [...recommended.map((r) => r.block), ...SURVEY_BLOCKS.filter((b) => !rec.has(b.id))]
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-primary/80">Быстрый старт</p>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Блоки углубления</h1>
        <p className="mt-1 text-xs text-on-surface-variant">Каждый блок уточняет Точку А. Заполняйте в любом порядке — всё сохраняется в одну анкету.</p>
      </div>
      <ul className="space-y-2">
        {ordered.map((b) => {
          const p = blockProgress(b, answers)
          return (
            <li key={b.id}>
              <Link href={`/client/onboarding/blocks/${b.id}`} data-block={b.id}
                className={`flex min-h-[56px] items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${rec.has(b.id) ? 'border-primary/30 bg-primary/[0.05] hover:bg-primary/[0.09]' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                <span className={`material-symbols-outlined mt-0.5 text-base ${p.complete ? 'text-primary' : 'text-on-surface-variant'}`} aria-hidden="true">{p.complete ? 'check_circle' : 'radio_button_unchecked'}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-on-surface">
                    {b.title}
                    {rec.has(b.id) && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Рекомендуем</span>}
                  </span>
                  <span className="block text-[11px] text-on-surface-variant">{b.why} · ~{b.minutes} мин</span>
                  <span className="block text-[11px] text-on-surface-variant/80">{blockProgressText(p)}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
