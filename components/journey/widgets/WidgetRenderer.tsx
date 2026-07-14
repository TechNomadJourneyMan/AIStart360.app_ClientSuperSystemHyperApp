'use client'

// Dispatches each widget kind to its own presenter. Keeping presenters
// small and colocated makes it cheap to add a new widget kind — the AI
// just returns a new `kind` string, we add the case here, done.

import type {
  Widget,
  QuestionWidget,
  UploadPromptWidget,
  InsightCardWidget,
  CrmCheckWidget,
  StackAuditWidget,
  VideoRecWidget,
  NewsDigestWidget,
  RemindersRailWidget,
  MetricPeekWidget,
  BenchmarkStripWidget,
  RiskAlertWidget,
  QuickWinWidget,
  CustomModuleWidget,
} from '@/lib/journey/state'

export interface WidgetRendererProps {
  w: Widget
  /** Send an answer back to the chat (question options, crm picks, …) */
  onAnswer?: (text: string) => void
}

export function WidgetRenderer({ w, onAnswer }: WidgetRendererProps) {
  switch (w.kind) {
    case 'question':        return <Question w={w} onAnswer={onAnswer} />
    case 'upload_prompt':   return <UploadPrompt w={w} />
    case 'insight_card':    return <InsightCard w={w} />
    case 'crm_check':       return <CrmCheck w={w} />
    case 'stack_audit':     return <StackAudit w={w} />
    case 'video_rec':       return <VideoRec w={w} />
    case 'news_digest':     return <NewsDigest w={w} />
    case 'reminders_rail':  return <RemindersRail w={w} />
    case 'metric_peek':     return <MetricPeek w={w} />
    case 'benchmark_strip': return <BenchmarkStrip w={w} />
    case 'risk_alert':      return <RiskAlert w={w} />
    case 'quick_win':       return <QuickWin w={w} />
    case 'custom_module':   return <CustomModule w={w} />
  }
}

// ── question ─────────────────────────────────────────────────────────

function Question({ w, onAnswer }: { w: QuestionWidget; onAnswer?: (text: string) => void }) {
  return (
    <div>
      <p className="text-sm text-on-surface leading-relaxed mb-3">{w.prompt}</p>
      {w.options && (
        <div className="flex flex-wrap gap-1.5">
          {w.options.map((o) => (
            <button
              key={o}
              onClick={() => onAnswer?.(o)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-white/[0.08] text-on-surface hover:border-primary/40 hover:text-primary transition-colors active:scale-95"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── upload_prompt ────────────────────────────────────────────────────

function UploadPrompt({ w }: { w: UploadPromptWidget }) {
  return (
    <div>
      <p className="text-sm text-on-surface mb-3">{w.reason}</p>
      <label className="block cursor-pointer">
        <input type="file" className="hidden" multiple />
        <div className="border border-dashed border-white/[0.12] rounded-lg p-4 text-center text-xs text-on-surface-variant hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all">
          <span className="material-symbols-outlined text-2xl block mb-1 text-primary">upload_file</span>
          Перетащи файл или клик
        </div>
      </label>
      {w.suggestions && w.suggestions.length > 0 && (
        <p className="text-[10px] text-on-surface-variant/60 mt-2">
          Годится: {w.suggestions.join(', ')}
        </p>
      )}
    </div>
  )
}

// ── insight_card ─────────────────────────────────────────────────────

function InsightCard({ w }: { w: InsightCardWidget }) {
  const bar =
    w.severity === 'critical' ? 'bg-error'
    : w.severity === 'warn'   ? 'bg-tertiary-container'
    : w.severity === 'ok'     ? 'bg-primary'
                              : 'bg-on-surface-variant/40'
  return (
    <div>
      <div className={`h-0.5 w-8 rounded-full ${bar} mb-2.5`} />
      <p className="text-sm font-semibold text-on-surface leading-snug">{w.headline}</p>
      <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">{w.body}</p>
      {w.quote && (
        <div className="mt-3 p-2.5 rounded-lg bg-surface-container-low border border-white/[0.04]">
          <p className="text-[11px] italic text-on-surface leading-relaxed">
            «{w.quote.text}»
          </p>
          <p className="text-[10px] text-on-surface-variant/60 mt-1.5 font-mono">
            — {w.quote.source}
          </p>
        </div>
      )}
    </div>
  )
}

// ── crm_check ────────────────────────────────────────────────────────

function CrmCheck({ w }: { w: CrmCheckWidget }) {
  return (
    <div>
      <p className="text-sm text-on-surface mb-3">
        {w.hasCrm === null ? 'В чём сейчас ведёшь сделки?' : w.currentTool || '—'}
      </p>
      {w.hasCrm !== false && (
        <div className="space-y-2">
          {w.suggestions.map((s) => (
            <div key={s.name} className="rounded-lg bg-surface-container-low border border-white/[0.04] p-2.5">
              <p className="text-xs font-semibold text-on-surface">{s.name}</p>
              <p className="text-[10px] text-on-surface-variant/70 mt-0.5">{s.whyFit}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── stack_audit ──────────────────────────────────────────────────────

function StackAudit({ w }: { w: StackAuditWidget }) {
  return (
    <div className="space-y-3">
      {w.categories.map((c) => (
        <div key={c.label}>
          <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1.5">
            {c.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {c.all.map((tool) => {
              const active = c.picked.includes(tool)
              return (
                <span
                  key={tool}
                  className={`text-[10px] px-2 py-1 rounded-md border ${
                    active
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-surface-container-low text-on-surface-variant border-white/[0.06]'
                  }`}
                >
                  {tool}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── video_rec ────────────────────────────────────────────────────────

function VideoRec({ w }: { w: VideoRecWidget }) {
  return (
    <div className="space-y-2">
      {w.videos.map((v) => (
        <a
          key={v.title}
          href={v.url}
          target="_blank"
          rel="noreferrer"
          className="flex gap-3 p-2 rounded-lg bg-surface-container-low border border-white/[0.04] hover:border-primary/30 transition-colors"
        >
          <div className="w-16 h-11 rounded bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-lg">play_circle</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-on-surface leading-snug truncate">{v.title}</p>
            <p className="text-[10px] text-on-surface-variant/70 mt-0.5">{v.durationMin} мин · {v.whyRelevant}</p>
          </div>
        </a>
      ))}
    </div>
  )
}

// ── news_digest ──────────────────────────────────────────────────────

function NewsDigest({ w }: { w: NewsDigestWidget }) {
  return (
    <div className="space-y-1.5">
      {w.items.map((it) => (
        <a
          key={it.title}
          href={it.url}
          target="_blank"
          rel="noreferrer"
          className="block p-2 rounded-lg hover:bg-white/[0.03] transition-colors"
        >
          <p className="text-xs font-medium text-on-surface leading-snug line-clamp-2">{it.title}</p>
          <p className="text-[10px] text-on-surface-variant/60 mt-1 font-mono">
            {it.source} · {it.ago}
          </p>
        </a>
      ))}
    </div>
  )
}

// ── reminders_rail ───────────────────────────────────────────────────

function RemindersRail({ w }: { w: RemindersRailWidget }) {
  return (
    <ul className="space-y-2">
      {w.items.map((it) => (
        <li key={it.id} className="flex items-start gap-2.5">
          <input
            type="checkbox"
            defaultChecked={it.done}
            className="mt-0.5 w-3.5 h-3.5 accent-primary flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className={`text-xs leading-snug ${it.done ? 'line-through text-on-surface-variant/50' : 'text-on-surface'}`}>
              {it.text}
            </p>
            <p className="text-[10px] text-on-surface-variant/60 mt-0.5">{it.due}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── metric_peek ──────────────────────────────────────────────────────

function MetricPeek({ w }: { w: MetricPeekWidget }) {
  const max = Math.max(...w.trend)
  const min = Math.min(...w.trend)
  const range = max - min || 1
  const pts = w.trend
    .map((y, i) => `${(i / (w.trend.length - 1)) * 100},${100 - ((y - min) / range) * 100}`)
    .join(' ')
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="font-mono text-2xl font-extrabold text-on-surface">{w.value}</p>
        {w.delta && <p className="text-xs font-mono text-primary">{w.delta}</p>}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-14">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary" />
      </svg>
      <p className="text-[10px] text-on-surface-variant/60 mt-1 font-mono">{w.label}</p>
    </div>
  )
}

// ── benchmark_strip ──────────────────────────────────────────────────

function BenchmarkStrip({ w }: { w: BenchmarkStripWidget }) {
  const yourPct   = (w.your   / w.top) * 100
  const medianPct = (w.median / w.top) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-on-surface-variant">{w.metric}</p>
        <p className="font-mono text-lg font-bold text-on-surface">
          {w.your}{w.unit}
        </p>
      </div>
      <div className="relative h-2 rounded-full bg-surface-container-low overflow-visible">
        <div className="absolute top-0 left-0 h-full bg-primary rounded-full" style={{ width: `${yourPct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-on-surface" style={{ left: `${medianPct}%` }} title={`медиана ${w.median}${w.unit}`} />
      </div>
      <div className="flex justify-between text-[9px] font-mono text-on-surface-variant/60 mt-1.5">
        <span>ты · {w.your}{w.unit}</span>
        <span>медиана · {w.median}{w.unit}</span>
        <span>топ · {w.top}{w.unit}</span>
      </div>
    </div>
  )
}

// ── risk_alert ───────────────────────────────────────────────────────

function RiskAlert({ w }: { w: RiskAlertWidget }) {
  return (
    <div className="rounded-lg border border-error/25 bg-error/5 p-3 -m-0.5">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined text-error text-base mt-0.5">warning</span>
        <div>
          <p className="text-xs font-semibold text-error">Риск</p>
          <p className="text-xs text-on-surface mt-1 leading-relaxed">{w.reason}</p>
          <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
            <span className="font-semibold text-on-surface">Что делать:</span> {w.suggestion}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── custom_module ────────────────────────────────────────────────────
// AI-composed free-form block. Body is plain text with light markdown
// (**bold**, - bullets). We render minimally without a md library.

function CustomModule({ w }: { w: CustomModuleWidget }) {
  const lines = w.body.split('\n')
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return (
            <div key={i} className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
              <span className="w-1 h-1 rounded-full bg-primary mt-1.5 flex-shrink-0" />
              <span>{stripBold(trimmed.slice(2))}</span>
            </div>
          )
        }
        return (
          <p key={i} className="text-xs text-on-surface leading-relaxed">
            {stripBold(trimmed)}
          </p>
        )
      })}
    </div>
  )
}

function stripBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1')
}

// ── quick_win ────────────────────────────────────────────────────────

function QuickWin({ w }: { w: QuickWinWidget }) {
  const effortLabel = w.effort === 'S' ? 'быстро' : w.effort === 'M' ? 'средне' : 'долго'
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 -m-0.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-primary text-base">bolt</span>
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">Quick Win</p>
        <span className="text-[10px] font-mono text-on-surface-variant ml-auto">{effortLabel}</span>
      </div>
      <p className="text-sm font-semibold text-on-surface leading-snug">{w.expectedImpact}</p>
      <ol className="mt-3 space-y-1.5 list-decimal list-inside text-xs text-on-surface-variant leading-relaxed marker:text-primary">
        {w.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </div>
  )
}
