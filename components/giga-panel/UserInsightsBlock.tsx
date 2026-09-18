'use client'

// Compact User 360 summary inside the request / client drawers: survey fill by
// theme, GRI, journey stage — with a link to the full User 360 page.
import Link from 'next/link'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import { useGigaQuery } from './kit'
import type { User360Profile } from './user360/types'

const tone = (v: number) => (v >= 7 ? '#6effc0' : v >= 4 ? '#fbbf24' : '#ef4444')

export function UserInsightsBlock({ userId }: { userId: string }) {
  const { data, error, loading } = useGigaQuery<{ data: User360Profile }>(`/api/giga-admin/users/${userId}/profile`)
  const d = data?.data

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-300">User 360</span>
        <Link href={`/admin-giga-panel/users/${userId}`} className="flex items-center gap-1 text-[11px] text-blue-300 hover:underline">
          Открыть полностью <ArrowUpRight size={12} />
        </Link>
      </div>
      {loading && !d && (
        <div className="flex items-center gap-2 py-3 text-[11px] text-slate-500"><Loader2 size={13} className="animate-spin" /> Загрузка…</div>
      )}
      {error && <p className="py-2 text-[11px] text-red-300">{error.message}</p>}
      {d && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="font-mono text-base font-bold text-slate-100">{d.survey.percent}%</p><p className="text-[9px] text-slate-500">анкета</p></div>
            <div><p className="font-mono text-base font-bold text-slate-100">{d.gri.current ? d.gri.current.index.toFixed(1) : '—'}</p><p className="text-[9px] text-slate-500">GRI · {d.gri.runs} прох.</p></div>
            <div><p className="font-mono text-base font-bold text-slate-100">{d.journey.completed}/{d.journey.total}</p><p className="text-[9px] text-slate-500">{d.journey.current?.label ?? 'путь'}</p></div>
          </div>
          <div className="space-y-1">
            {d.survey.sections.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="w-36 shrink-0 truncate text-[10px] text-slate-500">{s.title}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${s.total ? (s.filled / s.total) * 100 : 0}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-[10px] text-slate-400">{s.filled}/{s.total}</span>
              </div>
            ))}
          </div>
          {d.gri.current && (
            <div className="space-y-1 border-t border-white/[0.05] pt-2">
              {GRI_SECTIONS.map((sec) => {
                const v = Number(d.gri.current?.sectionAvgs?.[sec.id] ?? 0)
                return (
                  <div key={sec.id} className="flex items-center gap-2">
                    <span className="w-36 shrink-0 truncate text-[10px] text-slate-500">{GRI_BLOCK_RU[sec.id]}</span>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div className="h-full rounded-full" style={{ width: `${v * 10}%`, background: tone(v) }} />
                    </div>
                    <span className="w-8 text-right font-mono text-[10px]" style={{ color: tone(v) }}>{v ? v.toFixed(1) : '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
