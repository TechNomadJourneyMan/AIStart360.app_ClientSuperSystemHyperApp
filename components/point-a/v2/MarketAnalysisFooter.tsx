'use client'

/**
 * MarketAnalysisFooter — client-side collapsible footer listing the 6
 * blocks / 50 parameters of the full market analysis. Used by
 * MarketAnalysisCard.
 */

import Link from 'next/link'
import { useState } from 'react'

const BLOCKS: Array<{ id: string; title: string; icon: string; params: number; preview: string }> = [
  {
    id: 'size',
    title: 'Размер рынка',
    icon: 'language',
    params: 9,
    preview: 'TAM, SAM, SOM, CAGR, фазы, насыщение',
  },
  {
    id: 'trends',
    title: 'Тренды и драйверы',
    icon: 'trending_up',
    params: 8,
    preview: 'Окна возможностей, спрос, регуляторика',
  },
  {
    id: 'barriers',
    title: 'Барьеры входа',
    icon: 'block',
    params: 7,
    preview: 'Капитал, лицензии, бренд, технологии',
  },
  {
    id: 'competitors',
    title: 'Конкуренты',
    icon: 'groups',
    params: 12,
    preview: 'Лидеры, доли, ценовая стратегия, слабости',
  },
  {
    id: 'segments',
    title: 'Микросегменты ×10',
    icon: 'stars',
    params: 8,
    preview: 'JTBD, портрет, LTV, готовность платить',
  },
  {
    id: 'risks',
    title: 'Риски и сценарии',
    icon: 'shield',
    params: 6,
    preview: 'PESTEL, downturn, регуляторные риски',
  },
]

export default function MarketAnalysisFooter() {
  // Expanded by default — full breakdown of 6 market blocks is shown inline.
  const [open, setOpen] = useState(true)

  return (
    <div className="border-t border-white/[0.04] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-4 px-5 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-3.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
      >
        <span>
          {open ? 'Скрыть' : 'Показать'} полный анализ рынка: 6 блоков, 50 параметров
        </span>
        <span
          className={`material-symbols-outlined text-base transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="pb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {BLOCKS.map((b) => (
              <div
                key={b.id}
                className="flex items-start gap-3 bg-surface-container rounded-xl border border-white/[0.04] p-3 hover:border-primary/20 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/[0.06] border border-primary/15 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-base text-primary">{b.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-on-surface truncate">{b.title}</p>
                    <span className="text-[10px] font-mono text-primary/70 tabular-nums whitespace-nowrap">
                      {b.params} параметров
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 truncate" title={b.preview}>
                    {b.preview}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <Link
              href="/market"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded px-1"
            >
              Открыть Market Intelligence Portal
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
