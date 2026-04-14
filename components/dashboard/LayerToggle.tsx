'use client'

import { useTranslations } from 'next-intl'
import type { DataLayer } from '@/types/metrics'

const LAYER_DEFS: { key: DataLayer; labelKey: string; icon: string; color: string }[] = [
  { key: 'fact',     labelKey: 'dashboard.layers.fact',     icon: 'show_chart',    color: 'text-primary'  },
  { key: 'forecast', labelKey: 'dashboard.layers.forecast', icon: 'trending_up',   color: 'text-secondary' },
  { key: 'goal',     labelKey: 'dashboard.layers.goal',     icon: 'flag',          color: 'text-yellow-400' },
  { key: 'compare',  labelKey: 'dashboard.layers.compare',  icon: 'compare_arrows',color: 'text-on-surface-variant' },
]

interface LayerToggleProps {
  activeLayers: DataLayer[]
  onToggle: (layer: DataLayer) => void
  availableLayers?: DataLayer[]
}

export function LayerToggle({ activeLayers, onToggle, availableLayers }: LayerToggleProps) {
  const t = useTranslations()
  const layers = availableLayers
    ? LAYER_DEFS.filter((l) => availableLayers.includes(l.key))
    : LAYER_DEFS

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
            title={isFixed ? t('dashboard.layers.factAlwaysOn') : undefined}
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
            {t(l.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
