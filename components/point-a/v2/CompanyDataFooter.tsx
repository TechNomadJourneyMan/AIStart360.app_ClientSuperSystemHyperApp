'use client'

/**
 * CompanyDataFooter — client-side collapsible footer rendering the 7 анкета
 * blocks with their fill %. Used by CompanyDataCard.
 */

import { useState } from 'react'

interface Block {
  id: string
  title: string
  icon: string
  pct: number
  stepLabels: string[]
}

function toneForPct(pct: number): { text: string; border: string; bg: string; bar: string } {
  if (pct >= 80) {
    return {
      text: 'text-primary',
      border: 'border-primary/20',
      bg: 'bg-primary/5',
      bar: 'bg-primary',
    }
  }
  if (pct >= 40) {
    return {
      text: 'text-amber-400',
      border: 'border-amber-400/20',
      bg: 'bg-amber-400/5',
      bar: 'bg-amber-400',
    }
  }
  return {
    text: 'text-error',
    border: 'border-error/20',
    bg: 'bg-error/5',
    bar: 'bg-error',
  }
}

export default function CompanyDataFooter({ blocks }: { blocks: Block[] }) {
  // Expanded by default — full anketa is shown inline on /point-a per spec.
  const [open, setOpen] = useState(true)

  return (
    <div className="border-t border-white/[0.04] -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-1 px-5 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-3.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
      >
        <span>
          {open ? 'Скрыть' : 'Показать'} все 7 блоков анкеты
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-5">
          {blocks.map((b) => {
            const tone = toneForPct(b.pct)
            const status = b.pct >= 80 ? 'Заполнено' : b.pct >= 40 ? 'Частично' : 'Пусто'
            return (
              <div
                key={b.id}
                className={`flex items-center gap-3 bg-surface-container rounded-xl border ${tone.border} p-3 hover:border-primary/20 transition-colors`}
              >
                <div
                  className={`w-8 h-8 rounded-lg ${tone.bg} ${tone.border} border flex items-center justify-center flex-shrink-0`}
                >
                  <span className={`material-symbols-outlined text-base ${tone.text}`}>{b.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-on-surface truncate">{b.title}</p>
                    <span className={`text-[10px] font-mono font-bold tabular-nums ${tone.text}`}>
                      {b.pct}%
                    </span>
                  </div>
                  <div className="h-1 bg-surface-container-high rounded-full overflow-hidden mt-1.5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                      style={{ width: `${Math.max(b.pct, 2)}%` }}
                    />
                  </div>
                  <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1 uppercase tracking-wider truncate">
                    {status} · {b.stepLabels.join(' · ')}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
