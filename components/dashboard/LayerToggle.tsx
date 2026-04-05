'use client'

import type { DataLayer } from '@/types/metrics'

const LAYERS: { key: DataLayer; label: string; icon: string; color: string }[] = [
  { key: 'fact',     label: 'Факт',     icon: 'show_chart',   color: 'text-primary'  },
  { key: 'forecast', label: 'Прогноз',  icon: 'trending_up',  color: 'text-secondary' },
  { key: 'goal',     label: 'Цель',     icon: 'flag',         color: 'text-yellow-400' },
  { key: 'compare',  label: 'Сравнение',icon: 'compare_arrows',color: 'text-on-surface-variant' },
]

interface LayerToggleProps {
  activeLayers: DataLayer[]
  onToggle: (layer: DataLayer) => void
  availableLayers?: DataLayer[]
}

export function LayerToggle({ activeLayers, onToggle, availableLayers }: LayerToggleProps) {
  const layers = availableLayers
    ? LAYERS.filter((l) => availableLayers.includes(l.key))
    : LAYERS

  return (
    <div className="flex gap-1 flex-wrap">
      {layers.map((l) => {
        const isActive = activeLayers.includes(l.key)
        const isFixed = l.key === 'fact'
        return (
          <button
            key={l.key}
            onClick={() => !isFixed && onToggle(l.key)}
            disabled={isFixed}
            title={isFixed ? 'Факт всегда включён' : undefined}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all duration-150
              ${isActive
                ? 'bg-white/[0.08] border border-white/[0.12] text-on-surface'
                : 'border border-white/[0.04] text-on-surface-variant/40 hover:text-on-surface-variant hover:border-white/[0.08]'}
              ${isFixed ? 'cursor-default' : 'cursor-pointer'}
            `}
          >
            <span className={`material-symbols-outlined text-[13px] ${isActive ? l.color : ''}`}>
              {l.icon}
            </span>
            {l.label}
          </button>
        )
      })}
    </div>
  )
}
