export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { EmptyState } from '@/components/common/EmptyState'
import { BlockInfo } from '@/components/assistant/BlockInfo'

export const metadata: Metadata = { title: 'Инсайты' }

export default async function InsightsPage() {
  const [reportCount, avgScoreRes] = await Promise.all([
    prisma.griReport.count(),
    prisma.griReport.aggregate({ _avg: { score: true } }),
  ])

  const avgScore = Number(avgScoreRes._avg.score ?? 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Аналитические инсайты
        </p>
        <div className="flex items-center gap-2">
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
            <span className="text-gradient">Инсайты</span>
          </h1>
          <BlockInfo title="Инсайты" align="left">
            <p><b>Что это:</b> ключевые наблюдения и рекомендации по данным GRI и рыночным сигналам.</p>
            <p><b>Что делает:</b> выделяет паттерны и узкие места, чтобы подсказать следующие шаги.</p>
          </BlockInfo>
        </div>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Ключевые наблюдения, паттерны и рекомендации на основе данных GRI и рыночных сигналов.
        </p>
      </section>

      {/* Stats Summary — real GRI aggregates across the base */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/20 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI отчёты</p>
              <BlockInfo title="GRI отчёты" align="left">
                <p><b>Что это:</b> общее число расчётов GRI, выполненных по всей базе компаний.</p>
                <p><b>Что делает:</b> показывает объём накопленной диагностики и активность оценок.</p>
              </BlockInfo>
            </div>
            <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary transition-colors">description</span>
          </div>
          <p className="text-3xl font-mono font-bold text-on-surface">{reportCount}</p>
          <p className="text-[10px] font-mono text-primary mt-2 uppercase tracking-tight">Общее количество расчётов</p>
        </div>
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/20 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Средний GRI</p>
              <BlockInfo title="Средний GRI" align="left">
                <p><b>Что это:</b> усреднённый индекс готовности к росту по всей базе компаний.</p>
                <p><b>Что делает:</b> даёт ориентир-бенчмарк, с которым можно сравнить свой результат.</p>
              </BlockInfo>
            </div>
            <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary transition-colors">analytics</span>
          </div>
          <p className="text-3xl font-mono font-bold text-on-surface">{(avgScore / 10).toFixed(1)}</p>
          <p className="text-[10px] font-mono text-primary mt-2 uppercase tracking-tight">Показатель по всей базе</p>
        </div>
      </section>

      <EmptyState
        icon="lightbulb"
        title="Инсайтов пока нет"
        description="Аналитические инсайты и сигналы появятся после прохождения диагностики и накопления данных по компании."
      />
    </div>
  )
}
