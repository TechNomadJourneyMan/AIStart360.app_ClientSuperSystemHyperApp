'use client'

import { AUDIENCES, SEGMENTS, describeRule, type Segment, type VisibilityRule } from '@/lib/platform/visibility'
import { cx } from './kit'

/** Audience picker shared by content pages, blocks and platform sections. */
export function VisibilityEditor({ value, onChange, compact }: { value: VisibilityRule; onChange: (v: VisibilityRule) => void; compact?: boolean }) {
  const segs = value.segments ?? []
  const toggle = (s: Segment) => onChange({ ...value, segments: segs.includes(s) ? segs.filter((x) => x !== s) : [...segs, s] })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(AUDIENCES) as Array<keyof typeof AUDIENCES>).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange({ audience: a, segments: a === 'segments' ? segs : undefined, match: a === 'segments' ? value.match ?? 'any' : undefined })}
            aria-pressed={value.audience === a}
            className={cx('rounded-lg border px-2.5 py-1 text-[11px] transition-colors', value.audience === a ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
          >
            {AUDIENCES[a]}
          </button>
        ))}
      </div>
      {value.audience === 'segments' && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
          <div className={cx('grid gap-1', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
            {(Object.keys(SEGMENTS) as Segment[]).map((s) => (
              <label key={s} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-slate-300 hover:bg-white/[0.03]">
                <input type="checkbox" checked={segs.includes(s)} onChange={() => toggle(s)} />
                {SEGMENTS[s]}
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
            Условие:
            <select value={value.match ?? 'any'} onChange={(e) => onChange({ ...value, match: e.target.value as 'any' | 'all' })} className="rounded-md border border-white/[0.1] bg-[#0b1128] px-1.5 py-0.5 text-slate-200">
              <option value="any">любой из сегментов</option>
              <option value="all">все сегменты сразу</option>
            </select>
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-500">Кто увидит: {describeRule(value)}</p>
    </div>
  )
}
