'use client'

// components/gri/page/GriHero.tsx — шапка страницы GRI: текущий индекс, цель,
// статус готовности и контекстный CTA. Чисто презентационный.
import { motion } from 'framer-motion'

export interface GriHeroProps {
  griIndex: number | null       // null — диагностика ещё не пройдена
  target?: number               // цель, по умолчанию 8.5
  assessedAt?: string | null    // ISO-дата последней диагностики
  onStartAssessment: () => void // CTA «Пройти тест» / «Обновить оценку»
}

export function heroStatus(gri: number | null): { label: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (gri == null) return { label: 'Диагностика не пройдена', tone: 'none' }
  if (gri >= 8) return { label: 'Высокая готовность', tone: 'ok' }
  if (gri >= 6) return { label: 'Средняя готовность', tone: 'warn' }
  return { label: 'Низкая готовность', tone: 'bad' }
}

const TONE_CLASS: Record<string, string> = {
  ok: 'text-primary border-primary/30 bg-primary/10',
  warn: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  bad: 'text-red-400 border-red-400/30 bg-red-400/10',
  none: 'text-on-surface-variant border-white/10 bg-white/[0.04]',
}

export default function GriHero({ griIndex, target = 8.5, assessedAt, onStartAssessment }: GriHeroProps) {
  const status = heroStatus(griIndex)
  return (
    <motion.section
      data-tour="gri-hero"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8"
    >
      <div className="flex items-end gap-3">
        <span className="text-5xl font-bold text-primary tabular-nums">
          {griIndex == null ? '—' : griIndex.toFixed(1)}
        </span>
        <span className="text-sm text-on-surface-variant pb-1.5">/ цель {target}+</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className={`inline-block px-2.5 py-1 rounded-full border text-xs font-medium ${TONE_CLASS[status.tone]}`}>
          {status.label}
        </span>
        {assessedAt && (
          <p className="text-xs text-on-surface-variant mt-1.5">
            Последняя диагностика: {new Date(assessedAt).toLocaleDateString('ru-RU')}
          </p>
        )}
      </div>
      <button
        onClick={onStartAssessment}
        className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        {griIndex == null ? 'Пройти диагностику' : 'Обновить оценку'}
      </button>
    </motion.section>
  )
}
