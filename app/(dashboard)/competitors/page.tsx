export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { EmptyState } from '@/components/common/EmptyState'

export const metadata: Metadata = {
  title: 'Конкурентный Анализ | AIStart360',
  description: 'Глубокий анализ конкурентной среды и рыночного позиционирования.'
}

export default async function CompetitorsPage() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-10 pb-20">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-surface-container-low border border-white/[0.05] p-10 lg:p-14">
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[80%] h-[80%] bg-primary rounded-full blur-[120px] animate-pulse" />
        </div>

        <div className="relative z-10 max-w-2xl">
          <h1 className="text-4xl lg:text-5xl xl:text-6xl font-headline font-extrabold text-on-surface leading-[1.1] mb-6 tracking-tight">
            Анализ <br/>
            <span className="text-gradient">Конкурентной Среды</span>
          </h1>

          <p className="text-lg text-on-surface-variant leading-relaxed">
            Мониторинг рыночных долей, технологического превосходства и стратегий роста основных игроков индустрии.
          </p>
        </div>
      </section>

      <EmptyState
        icon="radar"
        title="Данных по конкурентам нет"
        description="Конкурентный анализ появится после заполнения анкеты (блок «Продукт и конкуренты») и подключения источников рыночных данных."
      />

      {/* Landscape Map */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-surface-container-low to-surface border border-white/[0.05] p-10 lg:p-14 text-center">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-8 border border-primary/20">
            <span className="material-symbols-outlined text-4xl text-primary animate-pulse">explore</span>
          </div>
          <h2 className="text-3xl font-headline font-extrabold text-on-surface">Рыночное Позиционирование</h2>
          <p className="text-on-surface-variant leading-relaxed">
            Интерактивная карта рыночного ландшафта формируется по мере подключения источников данных.
            Подключите дополнительные источники для построения точной проекции.
          </p>
        </div>

        <div className="absolute top-1/2 left-10 -translate-y-1/2 opacity-5 pointer-events-none hidden lg:block">
           <span className="material-symbols-outlined text-[200px]">language</span>
        </div>
        <div className="absolute top-1/2 right-10 -translate-y-1/2 opacity-5 pointer-events-none hidden lg:block">
           <span className="material-symbols-outlined text-[200px]">radar</span>
        </div>
      </section>
    </div>
  )
}
