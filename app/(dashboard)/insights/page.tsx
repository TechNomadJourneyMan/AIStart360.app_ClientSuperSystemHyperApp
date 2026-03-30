import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Инсайты' }

export default async function InsightsPage() {
  const [reportCount, avgScore] = await Promise.all([
    prisma.griReport.count(),
    prisma.griReport.aggregate({ _avg: { overallScore: true } }),
  ])

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Аналитические инсайты · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          <span className="text-gradient">Инсайты</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Ключевые наблюдения, паттерны и рекомендации на основе данных.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">GRI отчёты</p>
          <p className="text-3xl font-mono font-bold text-on-surface">{reportCount}</p>
          <p className="text-xs text-on-surface-variant mt-2">Количество расчётов в базе</p>
        </div>
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Средний GRI</p>
          <p className="text-3xl font-mono font-bold text-on-surface">{Number(avgScore._avg.overallScore ?? 0).toFixed(1)}</p>
          <p className="text-xs text-on-surface-variant mt-2">Агрегированный показатель по отчётам</p>
        </div>
      </section>

      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
        <h2 className="font-headline text-lg font-bold text-on-surface mb-3">Лента инсайтов</h2>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Моки удалены. Для автоматических инсайтов нужно подключить источник сигналов и слой аналитики.
          Сейчас раздел отображает только подтверждённые данные из существующей базы.
        </p>
      </section>
    </div>
  )
}
