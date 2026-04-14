'use client'

import { useState } from 'react'
import { SURVEY_STEP_LABELS, SURVEY_LABELS, getStepFromKey, formatSurveyValue } from '@/lib/survey-labels'

interface SurveyOverviewProps {
  answers: Record<string, unknown>
  completedSteps: number[]
}

const STEP_ICONS: Record<number, string> = {
  1: 'business',
  2: 'payments',
  3: 'point_of_sale',
  4: 'settings',
  5: 'campaign',
  6: 'flag',
}

export function SurveyOverview({ answers, completedSteps }: SurveyOverviewProps) {
  const [openStep, setOpenStep] = useState<number | null>(null)

  if (Object.keys(answers).length === 0) {
    return (
      <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-8 text-center">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant/20 mb-3 block">assignment</span>
        <p className="text-sm text-on-surface-variant font-medium">Survey not completed</p>
        <p className="text-xs text-on-surface-variant/60 mt-1">Complete the survey for AI diagnostics</p>
        <a href="/client/onboarding" className="inline-flex items-center gap-1.5 mt-4 text-xs font-mono text-primary hover:text-primary/80 transition-colors">
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
          Go to Survey
        </a>
      </div>
    )
  }

  // Group answers by step
  const stepGroups: Record<number, Array<{ key: string; label: string; value: string }>> = {}
  for (const [key, value] of Object.entries(answers)) {
    const step = getStepFromKey(key)
    if (step === 0) continue
    if (!stepGroups[step]) stepGroups[step] = []
    const label = SURVEY_LABELS[key] || key
    const formatted = formatSurveyValue(key, value)
    if (formatted && formatted !== '—') {
      stepGroups[step].push({ key, label, value: formatted })
    }
  }

  const steps = Object.keys(stepGroups).map(Number).sort()

  return (
    <div className="space-y-2">
      {steps.map(step => {
        const isOpen = openStep === step
        const items = stepGroups[step]
        const isCompleted = completedSteps.includes(step)

        return (
          <div key={step} className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
            <button
              onClick={() => setOpenStep(isOpen ? null : step)}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isCompleted ? 'bg-primary/10 border border-primary/20' : 'bg-surface-container border border-white/[0.06]'}`}>
                <span className={`material-symbols-outlined text-base ${isCompleted ? 'text-primary' : 'text-on-surface-variant/50'}`}>
                  {STEP_ICONS[step] || 'description'}
                </span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-on-surface">{SURVEY_STEP_LABELS[step] || `Step ${step}`}</p>
                <p className="text-[10px] text-on-surface-variant font-mono">
                  {items.length} {items.length === 1 ? 'field' : items.length < 5 ? 'fields' : 'fields'}
                </p>
              </div>
              {isCompleted && (
                <span className="text-[9px] font-mono text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-md flex-shrink-0">
                  Completed
                </span>
              )}
              <span className={`material-symbols-outlined text-base text-on-surface-variant/50 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isOpen && (
              <div className="px-5 pb-4 border-t border-white/[0.03]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-3">
                  {items.map(item => (
                    <div key={item.key} className="min-w-0">
                      <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider mb-0.5 truncate">
                        {item.label}
                      </p>
                      <p className="text-sm text-on-surface break-words">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
