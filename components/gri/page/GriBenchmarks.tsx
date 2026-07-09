'use client'

// components/gri/page/GriBenchmarks.tsx — бенчмарки «вы vs топ-20% отрасли»:
// селект отрасли + горизонтальные gap-бары по 7 блокам GRI (чистый CSS, без
// recharts). Ориентиры v1 захардкожены в lib/gri/benchmarks.ts — экспертные
// оценки, не живая база (внизу честный дисклеймер).
import { useMemo, useState } from 'react'
import { computeGaps, listIndustries, type IndustryId } from '@/lib/gri/benchmarks'

const INDUSTRIES = listIndustries()

export default function GriBenchmarks({
  sectionAvgs,
}: {
  sectionAvgs: Record<string, number> | null | undefined
}) {
  const [industry, setIndustry] = useState<IndustryId>('universal')
  const gaps = useMemo(() => computeGaps(sectionAvgs, industry), [sectionAvgs, industry])

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
            Вы vs топ-20% отрасли
          </p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Сравните свои блоки с ориентирами верхних 20% рынка.
          </p>
        </div>
        <select
          aria-label="Отрасль для сравнения"
          value={industry}
          onChange={(e) => setIndustry(e.target.value as IndustryId)}
          className="px-3 py-2 rounded-xl border border-white/[0.10] bg-white/[0.04] text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 [&>option]:bg-[#12151c]"
        >
          {INDUSTRIES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.labelRu}
            </option>
          ))}
        </select>
      </div>

      {/* Легенда */}
      <div className="mt-4 flex items-center gap-4 text-[11px] text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary" aria-hidden />
          Вы
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-white/25" aria-hidden />
          Топ-20% отрасли
        </span>
      </div>

      {/* Gap-бары: подложка — топ-20%, поверх — ваш балл */}
      <ul className="mt-3 space-y-3">
        {gaps.map((g) => {
          const behind = g.gap > 0
          return (
            <li key={g.blockId} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-on-surface truncate">{g.blockLabelRu}</span>
                <span className="shrink-0 flex items-center gap-2 tabular-nums">
                  <span className="text-on-surface-variant text-xs">
                    {g.you.toFixed(1)} / {g.top20.toFixed(1)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                      behind
                        ? 'bg-red-400/10 text-red-300'
                        : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {behind ? `−${g.gap.toFixed(1)}` : `+${Math.abs(g.gap).toFixed(1)}`}
                  </span>
                </span>
              </div>
              <div className="relative h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-white/20"
                  style={{ width: `${(g.top20 / 10) * 100}%` }}
                  aria-hidden
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${(g.you / 10) * 100}%` }}
                  aria-hidden
                />
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-[11px] leading-snug text-on-surface-variant/80">
        Ориентиры v1 — экспертные оценки по рынку СНГ, не живая база данных.
        Используйте как направление, а не как точный замер.
      </p>
    </section>
  )
}
