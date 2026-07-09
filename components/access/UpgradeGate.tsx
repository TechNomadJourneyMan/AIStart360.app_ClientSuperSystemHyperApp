'use client'

/**
 * components/access/UpgradeGate.tsx — изящный upgrade-экран (Фаза 6, идея №25).
 * Показывается там, где free-пользователь упёрся в платную функцию. Оплата —
 * осознанная заглушка: CTA ведёт на биллинг в настройках.
 */

import Link from 'next/link'

const FEATURE_COPY: Record<string, { title: string; detail: string }> = {
  gri_full: {
    title: 'Повторный полный GRI — на тарифе Pro',
    detail:
      'Бесплатный тариф включает один полный проход GRI-диагностики. На Pro — пересчитывайте индекс без ограничений и отслеживайте динамику.',
  },
  pdf_export: {
    title: 'PDF-экспорт — на тарифе Pro',
    detail: 'Выгружайте брендированный PDF-отчёт по диагностике для банка, партнёров или команды.',
  },
  ai_chat: {
    title: 'AI-чат по вашему отчёту — на тарифе Pro',
    detail: 'Задавайте Гри свободные вопросы по вашим данным: разбор результатов, приоритеты, план.',
  },
  benchmarks: {
    title: 'Бенчмарки отрасли — на тарифе Pro',
    detail: 'Сравните каждый блок GRI с топ-20% вашей отрасли и увидьте реальный разрыв.',
  },
}

export function UpgradeGate({ feature, compact = false }: { feature: string; compact?: boolean }) {
  const copy = FEATURE_COPY[feature] ?? {
    title: 'Функция доступна на тарифе Pro',
    detail: 'Обновите тариф, чтобы открыть эту возможность.',
  }
  return (
    <div
      className={`rounded-2xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.07] to-transparent ${compact ? 'p-4' : 'p-6'} `}
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-xl text-amber-400 shrink-0">lock</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface">{copy.title}</p>
          {!compact && <p className="text-xs text-on-surface-variant mt-1">{copy.detail}</p>}
          <Link
            href="/settings?tab=billing"
            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-400/25 transition-colors"
          >
            Посмотреть тарифы
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
