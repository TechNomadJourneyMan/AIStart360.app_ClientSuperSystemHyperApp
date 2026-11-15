'use client'

/**
 * «Разбор ИИ» on the Point A page (R3-PA, решение PO «гибрид»): the paid AI
 * analysis is shown at once, as a draft — «Черновик ИИ — эксперт проверит» —
 * until an expert checks it («Проверено экспертом: имя, дата»); the expert's
 * corrections are already laid over the AI text (lib/point-a/ai-review.ts).
 * Statuses: готовится / не удался — повторить (the owner and staff; the retry
 * route keeps its own limit and the AI budget) / частично.
 * Presentational: the page passes the view and the retry action.
 */
import type { PointAAiAnalysisView } from '@/lib/point-a/ai-review'
import { AI_DRAFT_LABEL, AI_REVIEWED_LABEL, aiFailureText } from '@/lib/point-a/ai-review'
import { BLOCK_LIBRARY, isBlockKey } from '@/lib/point-a/v4/config'
import { BTN_GHOST, CARD, CHIP, Icon, SectionTitle } from './ui'
import { cn } from '@/lib/utils'

const HORIZON_RU: Record<string, string> = { '30_days': '30 дней', '90_days': '90 дней', '180_days': '180 дней' }
const FIELD_RU = { diagnosis: 'Что видно', benchmark_comparison: 'Сравнение с рынком', key_risk: 'Главный риск', top_recommendation: 'Что сделать' } as const

function fmtDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' }) : null
}

function EditedMark({ on }: { on: boolean }) {
  return on ? <span className={cn(CHIP, 'ml-2 bg-emerald-400/10 text-emerald-300 normal-case tracking-normal')}>поправлено экспертом</span> : null
}

export function AiAnalysisCard({ ai, canRetry, onRetry, retrying = false, showDiagnosis = false }: {
  ai: PointAAiAnalysisView
  /** The owner or staff (the retry route checks it again). */
  canRetry: boolean
  onRetry: () => void
  retrying?: boolean
  /** Staff: the failure code and the model. */
  showDiagnosis?: boolean
}) {
  if (ai.status === 'none') return null
  const a = ai.analysis
  const edited = new Set(ai.editedByExpert)
  const reviewedOn = fmtDate(ai.review?.at ?? null)
  const generatedOn = fmtDate(ai.generatedAt)
  const failed = ai.status === 'failed' || ai.status === 'partial'
  const processing = ai.status === 'processing' || retrying
  const blocks = a ? Object.entries(a.blocks) : []

  return (
    <section id="ai-analysis" className={cn(CARD, 'scroll-mt-24')} aria-labelledby="pa-ai" data-ai-status={ai.status}>
      <SectionTitle
        icon="auto_awesome"
        aside={ai.draft ? (
          <span className={cn(CHIP, 'bg-amber-300/10 text-amber-200 normal-case tracking-normal')} data-ai-draft>
            <Icon name="edit_note" className="text-[12px]" />{AI_DRAFT_LABEL}
          </span>
        ) : (
          <span className={cn(CHIP, 'bg-emerald-400/10 text-emerald-300 normal-case tracking-normal')} data-ai-reviewed suppressHydrationWarning>
            <Icon name="verified" className="text-[12px]" />{AI_REVIEWED_LABEL}{ai.review?.by ? `: ${ai.review.by}` : ''}{reviewedOn ? `, ${reviewedOn}` : ''}
          </span>
        )}
      >
        <span id="pa-ai">Разбор ИИ</span>
      </SectionTitle>

      {ai.draft && (
        <p className="-mt-1 mb-3 text-[11px] text-on-surface-variant">
          Разбор подготовлен ИИ по вашим данным. Эксперт проверит его и при необходимости поправит — здесь появится отметка «{AI_REVIEWED_LABEL}» с именем и датой.
        </p>
      )}

      {processing && (
        <p className="mb-3 flex items-center gap-2 text-sm text-on-surface" aria-live="polite" data-ai-processing>
          <Icon name="progress_activity" className="animate-spin text-[16px] text-primary" />
          Разбор готовится — обычно 1–2 минуты. Страница обновится сама.
        </p>
      )}

      {failed && !processing && (
        <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3" role="alert" data-ai-failed>
          <p className="text-sm text-on-surface">{aiFailureText(ai)}</p>
          {canRetry ? (
            <button type="button" className={cn(BTN_GHOST, 'mt-2')} onClick={onRetry} disabled={retrying}>
              <Icon name="refresh" className="text-[16px]" />Повторить разбор
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-on-surface-variant">Повторить разбор может владелец компании.</p>
          )}
          {showDiagnosis && ai.errorCode && <p className="mt-2 font-mono text-[10px] text-on-surface-variant">Причина: {ai.errorCode}</p>}
        </div>
      )}

      {a && (
        <div className="space-y-4">
          {a.executive_summary && (
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">Резюме<EditedMark on={edited.has('executive_summary')} /></p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface">{a.executive_summary}</p>
              {a.industry_context && <p className="mt-2 text-xs text-on-surface-variant">{a.industry_context}<EditedMark on={edited.has('industry_context')} /></p>}
            </div>
          )}

          {a.strategic_priorities.length > 0 && (
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">Приоритеты<EditedMark on={edited.has('strategic_priorities')} /></p>
              <ol className="mt-1.5 space-y-2">
                {a.strategic_priorities.map((p, i) => (
                  <li key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-sm font-semibold text-on-surface">{i + 1}. {p.title}</p>
                    {p.rationale && <p className="mt-1 text-xs text-on-surface-variant">{p.rationale}</p>}
                    {p.expected_impact && <p className="mt-1 text-xs text-primary/90">Эффект: {p.expected_impact}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {a.growth_roadmap.length > 0 && (
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">План 30 / 90 / 180 дней<EditedMark on={edited.has('growth_roadmap')} /></p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {a.growth_roadmap.map((r) => (
                  <div key={r.horizon} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-xs font-semibold text-on-surface">{HORIZON_RU[r.horizon] ?? r.horizon}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-on-surface-variant">
                      {r.actions.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {blocks.length > 0 && (
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">По блокам</p>
              <div className="mt-1.5 space-y-1.5">
                {blocks.map(([key, b]) => (
                  <details key={key} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-on-surface">
                      <span>{isBlockKey(key) ? BLOCK_LIBRARY[key].title : key}<EditedMark on={edited.has(`blocks.${key}`)} /></span>
                      <Icon name="expand_more" className="text-[18px] text-on-surface-variant transition-transform group-open:rotate-180" />
                    </summary>
                    <dl className="mt-2 space-y-1.5 text-xs">
                      {(Object.keys(FIELD_RU) as Array<keyof typeof FIELD_RU>).filter((f) => b[f]).map((f) => (
                        <div key={f}>
                          <dt className="text-on-surface-variant">{FIELD_RU[f]}</dt>
                          <dd className="text-on-surface">{b[f]}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
              </div>
            </div>
          )}

          {ai.expertNote && (
            <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.04] p-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">Комментарий эксперта к разбору</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface">{ai.expertNote}</p>
            </div>
          )}
        </div>
      )}

      {(generatedOn || (showDiagnosis && ai.model)) && (
        <p className="mt-3 text-[10px] font-mono text-on-surface-variant" suppressHydrationWarning>
          {generatedOn ? `Подготовлен ${generatedOn}` : ''}{showDiagnosis && ai.model ? ` · модель: ${ai.model}` : ''}
        </p>
      )}
    </section>
  )
}
