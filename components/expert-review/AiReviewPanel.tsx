'use client'

/**
 * «Проверка разбора ИИ» (R3-SLA, решение PO «гибрид») — the expert / staff
 * reads the AI analysis of the client's Point A, corrects it (summary, the
 * priorities, the plan 30/90/180, the texts by block, a note to the client) and
 * confirms it. The client then sees «Проверено экспертом: имя, дата» and the
 * corrections marked «поправлено экспертом».
 *
 * Used in GIGA (User 360 → «Точка А») and in the expert cabinet (/expert/clients/:id,
 * tab «Точка А») — the same API shape on two routes (lib/point-a/ai-review-route.ts).
 * The SLA task (migration 152): a saved correction is the reaction, the confirmation
 * the answer. Neutral dark styling — fits both cabinets.
 *
 * AiReviewView is presentational (unit-tested); AiReviewPanel loads and saves.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BLOCK_EDIT_FIELDS, PART_LABEL_RU, ROADMAP_HORIZONS, editsFromForm, reviewFormOf, applyExpertEdits,
  type AiReviewForm,
} from '@/lib/point-a/ai-review'
import type { AiReviewData } from '@/lib/point-a/ai-review-store'
import { BLOCK_LIBRARY, isBlockKey } from '@/lib/point-a/v4/config'
import { AI_REVIEW_ANCHOR } from '@/lib/expert-sla/links'
import { cn } from '@/lib/utils'

const HORIZON_RU: Record<(typeof ROADMAP_HORIZONS)[number], string> = { '30_days': '30 дней', '90_days': '90 дней', '180_days': '180 дней' }
const FIELD_RU: Record<(typeof BLOCK_EDIT_FIELDS)[number], string> = {
  diagnosis: 'Что видно', benchmark_comparison: 'Сравнение с рынком', key_risk: 'Главный риск', top_recommendation: 'Что сделать',
}
const STAGE_CLS: Record<string, string> = {
  breached: 'text-red-300', escalated: 'text-red-300', due_soon: 'text-amber-300', ok: 'text-slate-300', closed: 'text-emerald-300',
}

const inputCls = 'w-full rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-teal-400/40 focus:outline-none disabled:opacity-60'
const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500'
const btnCls = 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
    : ''
}

export interface AiReviewViewProps {
  data: AiReviewData | null
  form: AiReviewForm | null
  canEdit: boolean
  busy: 'save' | 'confirm' | null
  loading?: boolean
  error?: string | null
  message?: string | null
  onChange?: (form: AiReviewForm) => void
  onSave?: () => void
  onConfirm?: () => void
  onReset?: () => void
}

export function AiReviewView({ data, form, canEdit, busy, loading = false, error = null, message = null, onChange, onSave, onConfirm, onReset }: AiReviewViewProps) {
  const view = data?.view ?? null
  const reviewed = !!view && !view.draft && !!view.review
  const task = data?.task ?? null
  const set = (patch: Partial<AiReviewForm>) => { if (form && onChange) onChange({ ...form, ...patch }) }
  const editable = canEdit && !!data?.reviewable && !!form
  const blocks = form ? Object.keys(form.blocks) : []

  return (
    <section id={AI_REVIEW_ANCHOR} aria-labelledby="ai-review-title" className="scroll-mt-24 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4" data-ai-review>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="ai-review-title" className="text-sm font-semibold text-slate-100">Проверка разбора ИИ</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Клиент уже видит разбор с пометкой «Черновик ИИ — эксперт проверит». Поправьте текст и подтвердите — клиент увидит «Проверено экспертом» с вашим именем и датой.
          </p>
        </div>
        {view && view.status !== 'none' && (
          reviewed
            ? <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300" data-reviewed>Проверено: {view.review?.by ?? 'эксперт'}{view.review?.at ? `, ${fmtDateTime(view.review.at)}` : ''}</span>
            : <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[11px] font-medium text-amber-200" data-draft>Черновик ИИ — ждёт проверки</span>
        )}
      </div>

      {task && (
        <p className={cn('mt-2 text-[11px]', STAGE_CLS[task.stage] ?? 'text-slate-300')} data-sla-stage={task.stage}>
          {task.closedAt
            ? `Задача SLA закрыта ${fmtDateTime(task.closedAt)}`
            : <>Задача SLA: {task.timer} · ответ до {fmtDateTime(task.answerDueAt)}{task.firstResponseAt ? ' · в работе' : ` · реакция до ${fmtDateTime(task.reactionDueAt)}`}{task.assignee ? ` · исполнитель: ${task.assignee.name}` : ' · без исполнителя'}</>}
        </p>
      )}

      {loading && !data && <p className="mt-3 text-xs text-slate-500">Загрузка…</p>}
      {error && <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200" role="alert">{error}</p>}
      {message && <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-200" role="status">{message}</p>}

      {data && !view?.analysis && view?.status !== 'processing' && (
        <p className="mt-3 text-xs text-slate-400" data-empty>Разбора ИИ нет: он появится после официальной оценки Точки А у клиента с платным доступом.</p>
      )}
      {view?.status === 'processing' && <p className="mt-3 text-xs text-slate-400">Разбор готовится — проверить его можно, когда он будет готов.</p>}
      {view?.status === 'partial' && view.missingParts.length > 0 && (
        <p className="mt-3 text-xs text-amber-200">Разбор частичный: не получились части — {view.missingParts.map((p) => PART_LABEL_RU[p]).join('; ')}. Проверьте то, что есть.</p>
      )}

      {data?.reviewable && form && (
        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <label className={labelCls} htmlFor="air-summary">Резюме</label>
            <textarea id="air-summary" rows={4} className={inputCls} value={form.executive_summary} disabled={!editable} onChange={(e) => set({ executive_summary: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className={labelCls} htmlFor="air-industry">Отраслевой контекст</label>
            <textarea id="air-industry" rows={2} className={inputCls} value={form.industry_context} disabled={!editable} onChange={(e) => set({ industry_context: e.target.value })} />
          </div>

          <fieldset className="space-y-2">
            <legend className={labelCls}>Приоритеты</legend>
            {form.strategic_priorities.map((p, i) => (
              <div key={i} className="space-y-1 rounded-xl border border-white/[0.06] p-2">
                <input aria-label={`Приоритет ${i + 1}: название`} className={inputCls} value={p.title} disabled={!editable}
                  onChange={(e) => set({ strategic_priorities: form.strategic_priorities.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <textarea aria-label={`Приоритет ${i + 1}: обоснование`} rows={2} className={inputCls} value={p.rationale} disabled={!editable}
                  onChange={(e) => set({ strategic_priorities: form.strategic_priorities.map((x, j) => (j === i ? { ...x, rationale: e.target.value } : x)) })} />
                <input aria-label={`Приоритет ${i + 1}: эффект`} className={inputCls} value={p.expected_impact} disabled={!editable}
                  onChange={(e) => set({ strategic_priorities: form.strategic_priorities.map((x, j) => (j === i ? { ...x, expected_impact: e.target.value } : x)) })} />
                {editable && (
                  <button type="button" className="text-[11px] text-slate-500 hover:text-red-300" onClick={() => set({ strategic_priorities: form.strategic_priorities.filter((_, j) => j !== i) })}>Убрать приоритет</button>
                )}
              </div>
            ))}
            {editable && form.strategic_priorities.length < 6 && (
              <button type="button" className="text-[11px] font-medium text-teal-300 hover:underline"
                onClick={() => set({ strategic_priorities: [...form.strategic_priorities, { title: '', rationale: '', expected_impact: '' }] })}>+ Добавить приоритет</button>
            )}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className={labelCls}>План 30 / 90 / 180 дней — действие на строку</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {ROADMAP_HORIZONS.map((h) => (
                <div key={h} className="space-y-1">
                  <label className="text-[11px] text-slate-400" htmlFor={`air-${h}`}>{HORIZON_RU[h]}</label>
                  <textarea id={`air-${h}`} rows={4} className={inputCls} value={form.growth_roadmap[h]} disabled={!editable}
                    onChange={(e) => set({ growth_roadmap: { ...form.growth_roadmap, [h]: e.target.value } })} />
                </div>
              ))}
            </div>
          </fieldset>

          {blocks.length > 0 && (
            <fieldset className="space-y-2">
              <legend className={labelCls}>По блокам</legend>
              {blocks.map((k) => (
                <details key={k} className="rounded-xl border border-white/[0.06] p-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-200">{isBlockKey(k) ? BLOCK_LIBRARY[k].title : k}</summary>
                  <div className="mt-2 space-y-1.5">
                    {BLOCK_EDIT_FIELDS.map((f) => (
                      <div key={f} className="space-y-0.5">
                        <label className="text-[11px] text-slate-400" htmlFor={`air-${k}-${f}`}>{FIELD_RU[f]}</label>
                        <textarea id={`air-${k}-${f}`} rows={2} className={inputCls} value={form.blocks[k][f]} disabled={!editable}
                          onChange={(e) => set({ blocks: { ...form.blocks, [k]: { ...form.blocks[k], [f]: e.target.value } } })} />
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </fieldset>
          )}

          <div className="space-y-1">
            <label className={labelCls} htmlFor="air-note">Комментарий эксперта клиенту</label>
            <textarea id="air-note" rows={2} className={inputCls} value={form.note} disabled={!editable} placeholder="Необязательно" onChange={(e) => set({ note: e.target.value })} />
          </div>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {!reviewed && (
                <button type="button" className={cn(btnCls, 'border border-white/[0.1] text-slate-200 hover:bg-white/[0.05]')} disabled={!!busy} onClick={onSave}>
                  {busy === 'save' ? 'Сохраняем…' : 'Сохранить правки'}
                </button>
              )}
              <button type="button" className={cn(btnCls, 'bg-teal-400/90 text-slate-900 hover:bg-teal-300')} disabled={!!busy} onClick={onConfirm} data-confirm>
                {busy === 'confirm' ? 'Подтверждаем…' : reviewed ? 'Сохранить и подтвердить заново' : 'Подтвердить разбор'}
              </button>
              <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300" disabled={!!busy} onClick={onReset}>Вернуть текст ИИ</button>
              <span className="text-[10px] text-slate-600">Пустое поле — остаётся текст ИИ.</span>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Править и подтверждать разбор может эксперт клиента, SuperExpert или Admin.</p>
          )}
        </div>
      )}
    </section>
  )
}

export function AiReviewPanel({ apiUrl, canEdit }: { apiUrl: string; canEdit: boolean }) {
  const [data, setData] = useState<AiReviewData | null>(null)
  const [form, setForm] = useState<AiReviewForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'save' | 'confirm' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const formOf = useCallback((d: AiReviewData) => reviewFormOf(applyExpertEdits(d.ai, d.edits).content, d.edits?.note ?? null), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl, { credentials: 'include' })
      const body = await res.json().catch(() => null) as { ok?: boolean; data?: AiReviewData; error?: string } | null
      if (!res.ok || !body?.ok || !body.data) throw new Error(body?.error ?? (res.status === 403 ? 'Этот клиент вам не назначен' : 'Не удалось загрузить разбор'))
      setData(body.data)
      setForm(formOf(body.data))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить разбор')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, formOf])

  useEffect(() => { void load() }, [load])

  const submit = async (kind: 'save' | 'confirm') => {
    if (!data?.diagnosticId || !form) return
    setBusy(kind)
    setMessage(null)
    try {
      const edits = editsFromForm(form)
      const res = await fetch(apiUrl, {
        method: kind === 'save' ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnosticId: data.diagnosticId, edits: Object.keys(edits).length ? edits : null }),
      })
      const body = await res.json().catch(() => null) as { ok?: boolean; data?: AiReviewData; error?: string } | null
      if (!res.ok || !body?.ok || !body.data) throw new Error(body?.error ?? 'Не удалось сохранить')
      setData(body.data)
      setForm(formOf(body.data))
      setError(null)
      setMessage(kind === 'save' ? 'Правки сохранены — клиент уже видит их с пометкой «поправлено экспертом».' : 'Разбор подтверждён — клиент видит «Проверено экспертом».')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(null)
    }
  }

  const reset = useMemo(() => () => { if (data) setForm(reviewFormOf(data.ai, null)) }, [data])

  return (
    <AiReviewView
      data={data} form={form} canEdit={canEdit} busy={busy} loading={loading} error={error} message={message}
      onChange={setForm} onSave={() => void submit('save')} onConfirm={() => void submit('confirm')} onReset={reset}
    />
  )
}
