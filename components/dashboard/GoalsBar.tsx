'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useUIStore } from '@/stores/ui.store'
import type { Goal } from '@/types'
import { toast } from '@/stores/ui.store'

const MAX_GOALS = 5

export function GoalsBar() {
  const t = useTranslations()
  const { pinnedGoals, addGoal, removeGoal } = useUIStore()
  const [open, setOpen] = useState(false)
  const [customLabel, setCustomLabel] = useState('')

  const PRESET_GOALS: Goal[] = [
    { id: 'g1',  label: t('goals.presets.g1'),  category: 'revenue',   targetValue: 2000000, targetUnit: 'USD', isCustom: false },
    { id: 'g2',  label: t('goals.presets.g2'),  category: 'margin',    targetValue: 40,      targetUnit: '%',   isCustom: false },
    { id: 'g3',  label: t('goals.presets.g3'),  category: 'clients',   targetValue: 100,     targetUnit: '',    isCustom: false },
    { id: 'g4',  label: t('goals.presets.g4'),  category: 'custom',                                             isCustom: false },
    { id: 'g5',  label: t('goals.presets.g5'),  category: 'custom',                                             isCustom: false },
    { id: 'g6',  label: t('goals.presets.g6'),  category: 'custom',                                             isCustom: false },
    { id: 'g7',  label: t('goals.presets.g7'),  category: 'revenue',                                            isCustom: false },
    { id: 'g8',  label: t('goals.presets.g8'),  category: 'custom',                                             isCustom: false },
    { id: 'g9',  label: t('goals.presets.g9'),  category: 'avg_check', targetValue: 2,       targetUnit: 'M₸', isCustom: false },
    { id: 'g10', label: t('goals.presets.g10'), category: 'custom',                                             isCustom: false },
    { id: 'g11', label: t('goals.presets.g11'), category: 'custom',                                             isCustom: false },
  ]

  const handleAdd = (goal: Goal) => {
    if (pinnedGoals.length >= MAX_GOALS) {
      toast.warning(t('goals.maxGoals'), t('goals.maxGoalsHint'))
      return
    }
    if (pinnedGoals.some((g) => g.id === goal.id)) return
    addGoal(goal)
  }

  const handleAddCustom = () => {
    if (!customLabel.trim()) return
    if (pinnedGoals.length >= MAX_GOALS) {
      toast.warning(t('goals.maxGoals'), t('goals.maxGoalsHint'))
      return
    }
    addGoal({
      id: `custom-${Date.now()}`,
      label: customLabel.trim(),
      category: 'custom',
      isCustom: true,
    })
    setCustomLabel('')
    setOpen(false)
  }

  return (
    <>
      {/* Pinned goals strip */}
      <div className="flex flex-wrap items-center gap-2">
        {pinnedGoals.length > 0 && (
          <span className="text-[10px] font-mono text-on-surface-variant/40 uppercase tracking-widest flex-shrink-0">
            {t('goals.label')}
          </span>
        )}

        {pinnedGoals.map((goal) => (
          <div
            key={goal.id}
            className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1"
          >
            <span className="material-symbols-outlined text-[13px] text-primary/60">flag</span>
            <span className="text-xs text-primary">{goal.label}</span>
            <button
              onClick={() => removeGoal(goal.id)}
              className="text-primary/30 hover:text-primary transition-colors ml-0.5"
              aria-label={t('goals.removeGoal')}
            >
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          </div>
        ))}

        {pinnedGoals.length < MAX_GOALS && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant/40 hover:text-primary transition-colors border border-dashed border-white/[0.08] hover:border-primary/30 rounded-full px-3 py-1"
          >
            <span className="material-symbols-outlined text-[14px]">add_circle</span>
            {pinnedGoals.length === 0 ? t('goals.addGrowthGoals') : ''}
          </button>
        )}
      </div>

      {/* Goal Picker Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full sm:max-w-lg bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-headline text-base font-bold text-on-surface">{t('goals.growthGoals')}</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-white/[0.06] transition-all"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <p className="text-xs text-on-surface-variant mb-4">
              {t('goals.selectedOf', { count: pinnedGoals.length, max: MAX_GOALS })}
            </p>

            {/* Preset list */}
            <div className="grid grid-cols-1 gap-1.5 mb-5 max-h-64 overflow-y-auto no-scrollbar pr-1">
              {PRESET_GOALS.map((goal) => {
                const pinned = pinnedGoals.some((g) => g.id === goal.id)
                const disabled = !pinned && pinnedGoals.length >= MAX_GOALS
                return (
                  <button
                    key={goal.id}
                    onClick={() => pinned ? removeGoal(goal.id) : handleAdd(goal)}
                    disabled={disabled}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      pinned
                        ? 'border-primary/30 bg-primary/10'
                        : disabled
                          ? 'border-white/[0.04] opacity-40 cursor-not-allowed'
                          : 'border-white/[0.06] hover:border-primary/30 hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-sm flex-shrink-0 ${pinned ? 'text-primary' : 'text-on-surface-variant/40'}`}>
                      {pinned ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className="text-sm text-on-surface">{goal.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Custom goal input */}
            <div className="border-t border-white/[0.04] pt-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
                {t('goals.customGoal')}
              </p>
              <div className="flex gap-2">
                <input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                  placeholder={t('goals.enterGoal')}
                  className="flex-1 bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 transition-all"
                />
                <button
                  onClick={handleAddCustom}
                  disabled={!customLabel.trim() || pinnedGoals.length >= MAX_GOALS}
                  className="px-4 py-2.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-xl text-sm font-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
