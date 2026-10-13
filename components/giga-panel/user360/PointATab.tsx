'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BadgeCheck, ChevronDown, ChevronRight, MessageSquarePlus, Pencil, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react'
import type { PointAComment, PointAState } from '@/lib/point-a/v4/state'
import type { V4Block } from '@/lib/point-a/v4/engine'
import { CHECK_LABELS } from '@/lib/point-a/v4/check-labels'
import {
  Badge, Button, EmptyState, ErrorState, GigaApiError, Panel, Skeleton, StatTile, cx, fmtDate, fmtDateTime, gigaFetch, inputClass, useGigaQuery, type Tone,
} from '../kit'

/**
 * Точка А клиента в User 360 (spec 2026-10-12 §7).
 *
 * Сверху — экспертный вид: тот же снимок, что видит клиент (балл, блоки,
 * проверки, гипотезы ИИ, метрики, расхождения), и работа эксперта: шаблон и
 * веса блоков, подтверждение / отклонение гипотез, правка фактов, закрытие
 * расхождений, комментарии (клиент видит их с подписью), «Отметить как
 * проверенное», «Пересчитать». Править может только тот, у кого есть
 * clients.review (сервер проверяет сам; здесь — только скрываем кнопки).
 *
 * Ниже, свёрнуто, — прежний разбор ИИ и дорожная карта из diagnostics.
 */

// ─── Expert view ─────────────────────────────────────────────────────────────

interface TemplateBlockRaw { key: string; weight: number; enabled: boolean }
interface V4Payload {
  companyId: string
  state: PointAState
  templates: Array<{ key: string; title: string }>
  templateBlocks: TemplateBlockRaw[]
  templateKey: string | null
  overrides: Record<string, { weight?: number; enabled?: boolean } | undefined>
}
type Discrepancy = PointAState['discrepancies'][number]
type SnapshotMetric = NonNullable<PointAState['snapshot']>['metrics'][number]

const STAGE: Record<string, string> = { seed: 'Старт', early: 'Ранняя', growth: 'Рост', scale: 'Масштаб', mature: 'Зрелость' }
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const round = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n)))
const fmtNum = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

function scoreTone(s: number | null): Tone {
  if (s == null) return 'neutral'
  return s >= 70 ? 'green' : s >= 45 ? 'amber' : 'red'
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id)
    try {
      await fn()
      toast.success(success)
      onDone()
      return true
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось выполнить действие')
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

export function PointATab({ userId, canReview = false }: { userId: string; canReview?: boolean }) {
  const [legacyOpen, setLegacyOpen] = useState(false)
  return (
    <div className="space-y-4">
      <ExpertPointA userId={userId} canReview={canReview} />
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setLegacyOpen((v) => !v)}
          aria-expanded={legacyOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-300 hover:text-slate-100"
        >
          <span>Разбор ИИ и дорожная карта (диагностика)</span>
          {legacyOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {legacyOpen && <div className="border-t border-white/[0.06] p-4"><LegacyPointA userId={userId} /></div>}
      </section>
    </div>
  )
}

function ExpertPointA({ userId, canReview }: { userId: string; canReview: boolean }) {
  const base = `/api/giga-admin/users/${userId}/point-a/v4`
  const { data, error, loading, reload } = useGigaQuery<{ data: V4Payload }>(base)
  const d = data?.data
  const { busy, run } = useAction(() => void reload())
  // While a recalculation is queued / running, refresh until it is done.
  const recalculating = !!d && d.state.recalculation !== 'idle'
  useEffect(() => {
    if (!recalculating) return
    const t = setInterval(() => void reload(), 5_000)
    return () => clearInterval(t)
  }, [recalculating, reload])

  if (loading && !d) return <Skeleton className="h-64" />
  if (error?.status === 404) {
    return <Panel><EmptyState title="Точки А нет" text={error.message} /></Panel>
  }
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!d) return null

  const s = d.state
  const snap = s.snapshot
  const comments = s.comments
  const blockComments = (key: string) => comments.filter((c) => c.targetKind === 'block' && c.targetKey === key)
  const metricComments = (key: string) => comments.filter((c) => c.targetKind === 'metric' && c.targetKey === key)
  const overallComments = comments.filter((c) => c.targetKind === 'overall')

  const addComment = (targetKind: PointAComment['targetKind'], targetKey: string | null, body: string) =>
    run(`comment:${targetKind}:${targetKey ?? ''}`, () => gigaFetch(`${base}/comments`, { method: 'POST', json: { targetKind, targetKey, body } }), 'Комментарий добавлен — клиент его увидит')
  const deleteComment = (id: string) =>
    run(`comment-del:${id}`, () => gigaFetch(`${base}/comments/${id}`, { method: 'DELETE' }), 'Комментарий удалён')
  const commentProps = { canReview, busy, onAdd: addComment, onDelete: deleteComment }

  return (
    <div className="space-y-4">
      <Panel
        title="Точка А (новый расчёт)"
        description={snap ? `Снимок от ${fmtDateTime(snap.createdAt)} · шаблон «${s.config.templateTitle}»` : 'Снимков ещё нет'}
        actions={
          <>
            {s.recalculation !== 'idle' && <Badge tone="amber">{s.recalculation === 'running' ? 'пересчитывается' : 'в очереди на пересчёт'}</Badge>}
            {s.review?.status === 'current' && <Badge tone="green"><BadgeCheck size={11} /> Проверено экспертом{s.review.by ? ` ${s.review.by}` : ''}, {fmtDate(s.review.at)}</Badge>}
            {s.review?.status === 'earlier' && <Badge tone="amber" title={`${s.review.by ?? ''} ${fmtDate(s.review.at)}`}>Проверено ранее, есть изменения</Badge>}
            {canReview && snap && s.review?.status !== 'current' && (
              <Button size="sm" variant="primary" icon={<BadgeCheck size={12} />} loading={busy === 'review'}
                onClick={() => void run('review', () => gigaFetch(`${base}/review`, { method: 'POST' }), 'Точка А отмечена как проверенная')}>
                Отметить как проверенное
              </Button>
            )}
            {canReview && (
              <Button size="sm" icon={<RefreshCw size={12} />} loading={busy === 'recalc'}
                onClick={() => void run('recalc', () => gigaFetch(`${base}/recalculate`, { method: 'POST' }), 'Точка А пересчитана')}>
                Пересчитать
              </Button>
            )}
          </>
        }
      >
        {!snap ? (
          <EmptyState title="Точка А ещё не рассчитана" text="Снимок появится после первого расчёта (анкета, документы или «Пересчитать»)." />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Балл" value={snap.overall == null ? '—' : `${round(snap.overall)}/100`} hint={snap.stage ? `стадия: ${STAGE[snap.stage] ?? snap.stage}` : undefined} tone="green" />
            <StatTile label="Достоверность" value={pct(snap.confidence)} hint="насколько балл опирается на факты" tone="blue" />
            <StatTile label="Покрытие данными" value={pct(snap.coverage)} hint={`анкета ${s.sources.survey.percent}% · документов ${s.sources.documents.parsed}`} tone="violet" />
            <StatTile label="GRI" value={s.gri.index100 == null ? '—' : String(s.gri.index100)} hint={s.gri.assessedAt ? fmtDate(s.gri.assessedAt) : 'тест не пройден'} tone="amber" />
          </div>
        )}
      </Panel>

      <BlocksPanel d={d} base={base} canReview={canReview} busy={busy} run={run} blockComments={blockComments} commentProps={commentProps} />

      {snap && (
        <MetricsPanel metrics={snap.metrics} base={base} canReview={canReview} busy={busy} run={run} metricComments={metricComments} commentProps={commentProps} />
      )}

      <DiscrepanciesPanel items={s.discrepancies} base={base} canReview={canReview} busy={busy} run={run} />

      <Panel title="Комментарии к Точке А" description="Общие заметки эксперта — клиент видит их с подписью">
        <Comments items={overallComments} targetKind="overall" targetKey={null} {...commentProps} />
      </Panel>
    </div>
  )
}

type Run = (id: string, fn: () => Promise<unknown>, success: string) => Promise<boolean>
interface CommentProps {
  canReview: boolean
  busy: string | null
  onAdd: (kind: PointAComment['targetKind'], key: string | null, body: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

// ─── Blocks: weights, template, hypotheses, checks ───────────────────────────

interface WeightDraft { weight: string; enabled: boolean }

function BlocksPanel({ d, base, canReview, busy, run, blockComments, commentProps }: {
  d: V4Payload; base: string; canReview: boolean; busy: string | null; run: Run
  blockComments: (key: string) => PointAComment[]; commentProps: CommentProps
}) {
  const s = d.state
  const tplOf = (key: string) => d.templateBlocks.find((b) => b.key === key) ?? { key, weight: 0, enabled: false }
  const initial = useMemo(() => {
    const out: Record<string, WeightDraft> = {}
    for (const l of s.library) {
      const t = tplOf(l.key)
      const o = d.overrides[l.key]
      out[l.key] = { weight: String(o?.weight ?? t.weight), enabled: o?.enabled ?? t.enabled }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])
  const [draft, setDraft] = useState(initial)
  // A reload (a comment, a recalculation) refreshes the weights only when the
  // expert has not typed anything unsaved.
  const shown = useRef(initial)
  useEffect(() => {
    setDraft((cur) => (JSON.stringify(cur) === JSON.stringify(shown.current) ? initial : cur))
    shown.current = initial
  }, [initial])
  const [open, setOpen] = useState<string | null>(null)

  const total = Object.values(draft).filter((b) => b.enabled).reduce((sum, b) => sum + Math.max(0, Number(b.weight) || 0), 0)
  const share = (key: string) => (draft[key]?.enabled && total > 0 ? Math.max(0, Number(draft[key].weight) || 0) / total : 0)
  const invalid = Object.values(draft).some((b) => { const n = Number(b.weight); return b.weight.trim() === '' || !Number.isFinite(n) || n < 0 || n > 10 })
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const saveWeights = () => {
    const expertOverrides: Record<string, { weight: number; enabled: boolean } | null> = {}
    for (const [key, b] of Object.entries(draft)) {
      const t = tplOf(key)
      const w = Number(b.weight)
      const sameAsTemplate = w === t.weight && b.enabled === t.enabled
      if (sameAsTemplate) { if (d.overrides[key]) expertOverrides[key] = null }
      else expertOverrides[key] = { weight: w, enabled: b.enabled }
    }
    if (!Object.keys(expertOverrides).length) return
    void run('weights', () => gigaFetch(`${base}/config`, { method: 'PATCH', json: { expertOverrides } }), 'Веса сохранены — балл клиента пересчитается')
  }

  const setTemplate = (key: string) =>
    void run('template', () => gigaFetch(`${base}/config`, { method: 'PATCH', json: { templateKey: key || null } }), 'Шаблон выбран — балл клиента пересчитается')

  const blocks = s.snapshot?.blocks ?? []
  return (
    <Panel
      title="Блоки"
      description="Вес — относительный (0…10): в балл идут доли включённых блоков. Пустое переопределение = как в шаблоне."
      actions={
        <>
          <label className="flex items-center gap-2 text-[11px] text-slate-500">
            Шаблон
            <select
              value={d.templateKey ?? ''}
              disabled={!canReview || busy === 'template'}
              onChange={(e) => setTemplate(e.target.value)}
              aria-label="Шаблон блоков"
              className="rounded-xl border border-white/[0.08] bg-[#0b1128] px-3 py-1.5 text-xs text-slate-200 focus:border-blue-500/40 focus:outline-none disabled:opacity-60"
            >
              <option value="">Авто по отрасли{!d.templateKey ? ` (${s.config.templateTitle})` : ''}</option>
              {d.templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
            </select>
          </label>
          {canReview && (
            <Button size="sm" variant="primary" icon={<Save size={12} />} loading={busy === 'weights'} disabled={!dirty || invalid} onClick={saveWeights}>
              Сохранить веса
            </Button>
          )}
        </>
      }
    >
      {invalid && <p className="mb-2 text-[11px] text-amber-300">Вес блока — число от 0 до 10.</p>}
      <ul className="space-y-2">
        {s.library.map((l) => {
          const b = blocks.find((x) => x.key === l.key)
          const cfg = s.config.blocks.find((x) => x.key === l.key)
          const w = draft[l.key] ?? { weight: '0', enabled: false }
          const overridden = !!d.overrides[l.key]
          const isOpen = open === l.key
          const notes = blockComments(l.key)
          return (
            <li key={l.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <button type="button" onClick={() => setOpen(isOpen ? null : l.key)} aria-expanded={isOpen} className="flex min-w-[160px] flex-1 items-center gap-2 text-left">
                  {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                  <span className={cx('text-sm font-medium', cfg ? 'text-slate-100' : 'text-slate-500')}>{l.title}</span>
                  {b ? (
                    b.score != null
                      ? <Badge tone={scoreTone(b.score)}>{Math.round(b.score)}{b.basis === 'inferred' ? ' · гипотеза' : ''}</Badge>
                      : <Badge>нет данных</Badge>
                  ) : <Badge>{cfg ? 'не посчитан' : 'выключен'}</Badge>}
                  {b?.hypothesis && !b.expertReview && <Badge tone="violet">гипотеза ИИ</Badge>}
                  {b?.expertReview && <Badge tone={b.expertReview.decision === 'confirmed' ? 'green' : 'red'}>{b.expertReview.decision === 'confirmed' ? 'гипотеза подтверждена' : 'гипотеза отклонена'}</Badge>}
                  {!!notes.length && <Badge tone="blue">{notes.length} комм.</Badge>}
                </button>
                <span className="text-[11px] text-slate-500">
                  {b ? `покрытие ${pct(b.coverage)} · достоверность ${pct(b.confidence)}` : ''}
                </span>
                <span className="w-24 text-right text-[11px] text-slate-400" title="Доля в балле сейчас">
                  вес {cfg ? pct(cfg.weight) : '—'}
                </span>
                {canReview ? (
                  <span className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-slate-400">
                      <input type="checkbox" checked={w.enabled} onChange={(e) => setDraft({ ...draft, [l.key]: { ...w, enabled: e.target.checked } })} className="accent-blue-500" />
                      в балле
                    </label>
                    <input
                      type="number" min={0} max={10} step={0.01} value={w.weight} disabled={!w.enabled}
                      onChange={(e) => setDraft({ ...draft, [l.key]: { ...w, weight: e.target.value } })}
                      aria-label={`Вес блока ${l.title}`}
                      className={cx(inputClass, 'w-20 py-1 text-xs')}
                    />
                    <span className="w-12 text-right text-[11px] tabular-nums text-slate-300" title="Доля после сохранения">{w.enabled ? pct(share(l.key)) : '—'}</span>
                    {overridden && (
                      <button type="button" title="Вернуть вес шаблона" aria-label={`Вернуть вес шаблона для блока ${l.title}`}
                        onClick={() => { const t = tplOf(l.key); setDraft({ ...draft, [l.key]: { weight: String(t.weight), enabled: t.enabled } }) }}
                        className="text-slate-500 hover:text-slate-200"><RotateCcw size={13} /></button>
                    )}
                  </span>
                ) : overridden ? <Badge tone="amber">вес изменён экспертом</Badge> : null}
              </div>
              {isOpen && (
                <div className="space-y-3 border-t border-white/[0.05] px-3 py-3">
                  {b ? <BlockDetails block={b} base={base} canReview={canReview} busy={busy} run={run} /> : <p className="text-xs text-slate-500">Блок не входит в текущий снимок.</p>}
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Комментарии к блоку</p>
                    <Comments items={notes} targetKind="block" targetKey={l.key} {...commentProps} />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function BlockDetails({ block: b, base, canReview, busy, run }: { block: V4Block; base: string; canReview: boolean; busy: string | null; run: Run }) {
  const decide = (decision: 'confirmed' | 'rejected') =>
    void run(`hyp:${b.key}`, () => gigaFetch(`${base}/hypotheses`, { method: 'POST', json: { block: b.key, decision } }),
      decision === 'confirmed' ? 'Гипотеза подтверждена, Точка А пересчитана' : 'Гипотеза отклонена, Точка А пересчитана')
  const withdraw = () =>
    void run(`hyp:${b.key}`, () => gigaFetch(`${base}/hypotheses?block=${b.key}`, { method: 'DELETE' }), 'Решение отменено, Точка А пересчитана')

  const checks = b.checks.filter((c) => !c.excluded)
  return (
    <>
      {(b.hypothesis || b.expertReview) && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-violet-200">
              Гипотеза ИИ{b.hypothesis ? `: ${b.hypothesis.score}/100 · уверенность ${pct(b.hypothesis.confidence)}` : ''}
            </p>
            {b.expertReview && (
              <span className="text-[11px] text-slate-400">
                {b.expertReview.decision === 'confirmed' ? 'Подтверждена' : 'Отклонена'}{b.expertReview.by ? ` · ${b.expertReview.by}` : ''} · {fmtDate(b.expertReview.at)}
              </span>
            )}
          </div>
          {b.hypothesis?.rationale && <p className="mt-1 text-xs text-slate-300">{b.hypothesis.rationale}</p>}
          {canReview && (
            <div className="mt-2 flex flex-wrap gap-2">
              {b.expertReview ? (
                <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} loading={busy === `hyp:${b.key}`} onClick={withdraw}>Отменить решение</Button>
              ) : b.status === 'insufficient_data' && b.hypothesis ? (
                <>
                  <Button size="sm" variant="primary" loading={busy === `hyp:${b.key}`} onClick={() => decide('confirmed')}>Подтвердить гипотезу</Button>
                  <Button size="sm" variant="danger" disabled={busy === `hyp:${b.key}`} onClick={() => decide('rejected')}>Отклонить</Button>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
      {!!b.needs.length && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-300/80">Чего не хватает</p>
          <ul className="space-y-0.5 text-xs text-slate-300">{b.needs.map((x, i) => <li key={i}>• {x}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Проверки ({b.earned}/{b.possible} баллов)</p>
        {!checks.length ? <p className="text-xs text-slate-600">Проверок нет.</p> : (
          <ul className="divide-y divide-white/[0.04] text-xs">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className={c.answered ? 'text-slate-200' : 'text-slate-500'}>{CHECK_LABELS[c.id] ?? c.id}</span>
                  {c.issue && <span className="block text-[11px] text-red-300/80">{c.issue}</span>}
                  {!c.answered && c.missing && <span className="block text-[11px] text-slate-500">{c.missing}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {!c.answered && <Badge>нет ответа</Badge>}
                  <span className="tabular-nums text-slate-300">{c.earned}/{c.max}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// ─── Metrics (fix a fact) ────────────────────────────────────────────────────

function MetricsPanel({ metrics, base, canReview, busy, run, metricComments, commentProps }: {
  metrics: SnapshotMetric[]; base: string; canReview: boolean; busy: string | null; run: Run
  metricComments: (key: string) => PointAComment[]; commentProps: CommentProps
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  return (
    <Panel title="Метрики расчёта" description="Значения, на которых построен снимок. «Исправить» записывает значение как ручное (источник — эксперт) и пересчитывает Точку А.">
      {!metrics.length ? <p className="text-xs text-slate-600">В снимке нет метрик — расчёт шёл только по анкете.</p> : (
        <ul className="divide-y divide-white/[0.05]">
          {metrics.map((m) => {
            const notes = metricComments(m.id)
            return (
              <li key={m.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-slate-200">{m.label}</span>
                  <span className="tabular-nums text-slate-100">{fmtNum(m.value)}{m.unit ? ` ${m.unit}` : ''}</span>
                  <span className="text-[11px] text-slate-500">{[m.period, m.source].filter(Boolean).join(' · ')}</span>
                  <span className="flex items-center gap-1">
                    {canReview && (
                      <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(editing === m.id ? null : m.id)}>Исправить</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<MessageSquarePlus size={12} />} onClick={() => setNotesFor(notesFor === m.id ? null : m.id)}>
                      {notes.length ? notes.length : ''}
                    </Button>
                  </span>
                </div>
                {editing === m.id && canReview && (
                  <FixValueForm metric={m} busy={busy === `value:${m.id}`} onCancel={() => setEditing(null)}
                    onSave={async (period, value, note) => {
                      const ok = await run(`value:${m.id}`, () => gigaFetch(`${base}/value`, { method: 'POST', json: { metricId: m.id, period, value, note: note || undefined } }), 'Значение сохранено — Точка А пересчитается')
                      if (ok) setEditing(null)
                    }} />
                )}
                {notesFor === m.id && (
                  <div className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
                    <Comments items={notes} targetKind="metric" targetKey={m.id} {...commentProps} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function FixValueForm({ metric, busy, onSave, onCancel }: {
  metric: SnapshotMetric; busy: boolean; onSave: (period: string, value: number, note: string) => void; onCancel: () => void
}) {
  const [period, setPeriod] = useState(() => (metric.period && /^\d{4}(-Q[1-4]|-\d{2})?$/.test(metric.period) ? metric.period : String(new Date().getFullYear() - 1)))
  const [value, setValue] = useState(String(metric.value))
  const [note, setNote] = useState('')
  const n = Number(value.replace(',', '.').replace(/\s/g, ''))
  const periodOk = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/.test(period.trim())
  const ok = value.trim() !== '' && Number.isFinite(n) && periodOk
  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-2 sm:grid-cols-[110px_140px_1fr_auto]">
      <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2025" aria-label="Период" title="2025, 2025-Q3 или 2025-09" className={cx(inputClass, 'py-1 text-xs')} />
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label="Значение" className={cx(inputClass, 'py-1 text-xs')} />
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Откуда значение (необязательно)" aria-label="Комментарий" className={cx(inputClass, 'py-1 text-xs')} />
      <span className="flex gap-1">
        <Button size="sm" variant="primary" loading={busy} disabled={!ok} onClick={() => onSave(period.trim(), n, note.trim())}>Сохранить</Button>
        <Button size="sm" variant="ghost" icon={<X size={12} />} aria-label="Отмена" onClick={onCancel} />
      </span>
      {!periodOk && <p className="text-[10px] text-amber-300 sm:col-span-4">Период: 2025, 2025-Q3 или 2025-09</p>}
    </div>
  )
}

// ─── Discrepancies ───────────────────────────────────────────────────────────

const KIND: Record<string, string> = { conflict: 'источники расходятся', invalid: 'значение вне диапазона', stale: 'устарело' }

function DiscrepanciesPanel({ items, base, canReview, busy, run }: { items: Discrepancy[]; base: string; canReview: boolean; busy: string | null; run: Run }) {
  return (
    <Panel title="Расхождения в данных" description={items.length ? `Открытых: ${items.length}. Решение эксперта закрывает расхождение и пересчитывает Точку А.` : undefined}>
      {!items.length ? <p className="text-xs text-slate-600">Открытых расхождений нет.</p> : (
        <ul className="space-y-3">
          {items.map((x) => <DiscrepancyItem key={x.id} item={x} base={base} canReview={canReview} busy={busy} run={run} />)}
        </ul>
      )}
    </Panel>
  )
}

function DiscrepancyItem({ item: x, base, canReview, busy, run }: { item: Discrepancy; base: string; canReview: boolean; busy: string | null; run: Run }) {
  const [custom, setCustom] = useState('')
  const n = Number(custom.replace(',', '.').replace(/\s/g, ''))
  const url = `${base}/discrepancies/${x.id}`
  const id = `disc:${x.id}`
  return (
    <li className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-100">{x.metricLabel}</span>
        <Badge>{x.periodLabel}</Badge>
        <Badge tone="amber">{KIND[x.kind] ?? x.kind}</Badge>
      </div>
      {x.detail && <p className="mt-1 text-xs text-slate-400">{x.detail}</p>}
      <ul className="mt-2 space-y-1">
        {x.candidates.map((c, i) => (
          <li key={`${c.sourceRef}:${i}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">
              <span className="tabular-nums text-slate-100">{fmtNum(c.value)}{c.unit ? ` ${c.unit}` : ''}</span>
              <span className="ml-2 text-slate-500">{c.sourceKind}{c.note ? ` · ${c.note}` : ''}</span>
            </span>
            {canReview && x.kind !== 'invalid' && (
              <Button size="sm" disabled={busy === id}
                onClick={() => void run(id, () => gigaFetch(url, { method: 'POST', json: { choice: 'candidate', index: i, expected: { sourceRef: c.sourceRef, value: c.value } } }), 'Расхождение закрыто')}>
                Взять это значение
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" placeholder="Своё значение" aria-label={`Своё значение для ${x.metricLabel}`} className={cx(inputClass, 'w-40 py-1 text-xs')} />
          <Button size="sm" variant="primary" disabled={busy === id || custom.trim() === '' || !Number.isFinite(n)}
            onClick={() => void run(id, () => gigaFetch(url, { method: 'POST', json: { choice: 'custom', value: n } }), 'Расхождение закрыто')}>
            Сохранить своё
          </Button>
          <Button size="sm" variant="ghost" disabled={busy === id}
            onClick={() => void run(id, () => gigaFetch(url, { method: 'POST', json: { choice: 'ignore' } }), 'Расхождение закрыто как неважное')}>
            Не важно
          </Button>
        </div>
      )}
    </li>
  )
}

// ─── Comments ────────────────────────────────────────────────────────────────

function Comments({ items, targetKind, targetKey, canReview, busy, onAdd, onDelete }: {
  items: PointAComment[]; targetKind: PointAComment['targetKind']; targetKey: string | null
} & CommentProps) {
  const [text, setText] = useState('')
  const addId = `comment:${targetKind}:${targetKey ?? ''}`
  return (
    <div className="space-y-2">
      {!items.length && <p className="text-xs text-slate-600">Комментариев нет.</p>}
      {items.map((c) => (
        <div key={c.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="whitespace-pre-wrap text-xs text-slate-200">{c.body}</p>
            {canReview && (
              <button type="button" aria-label="Удалить комментарий" disabled={busy === `comment-del:${c.id}`}
                onClick={() => void onDelete(c.id)} className="text-slate-600 hover:text-red-300 disabled:opacity-50">
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">{c.authorName ?? 'Эксперт'} · {fmtDateTime(c.createdAt)}</p>
        </div>
      ))}
      {canReview && (
        <div className="flex items-start gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Комментарий для клиента…" aria-label="Новый комментарий" className={cx(inputClass, 'text-xs')} />
          <Button size="sm" variant="primary" loading={busy === addId} disabled={!text.trim()}
            onClick={async () => { if (await onAdd(targetKind, targetKey, text.trim())) setText('') }}>
            Добавить
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Legacy: AI analysis and roadmap (diagnostics) ───────────────────────────

interface Item { title: string; text: string | null; tag: string | null }
interface LegacyBlock { id: string; label: string; score: number | null; status: string | null; topIssues: string[]; recommendations: string[] }
interface LegacyData {
  diagnostic: null | {
    id: string; overallScore: number | null; healthIndex: number | null; stage: string | null; calculatedAt: string | null; aiStatus: string | null
    blocks: LegacyBlock[]; risks: Item[]; insights: Item[]; quickWins: Item[]; dataGaps: Item[]
    summary: string | null; priorities: Item[]
    roadmap: Array<{ key: '30_days' | '90_days' | '180_days'; goals: string[]; actions: string[] }>
    industryContext: string | null
  }
  history: Array<{ id: string; overallScore: number | null; healthIndex: number | null; calculatedAt: string }>
  gri: null | { id: string; index: number; sectionAvgs: Record<string, number>; top5: Item[]; assessedAt: string }
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  critical: { label: 'критично', tone: 'red' },
  weak: { label: 'слабо', tone: 'red' },
  average: { label: 'средне', tone: 'amber' },
  strong: { label: 'сильно', tone: 'green' },
  excellent: { label: 'отлично', tone: 'green' },
}
const ROADMAP: Record<string, string> = { '30_days': '30 дней', '90_days': '90 дней', '180_days': '180 дней' }

function Items({ items, empty }: { items: Item[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-600">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="text-xs text-slate-300">
          <span className="font-medium text-slate-200">{it.title}</span>
          {it.tag && <Badge className="ml-2" tone={it.tag === 'critical' || it.tag === 'high' ? 'red' : 'neutral'}>{it.tag}</Badge>}
          {it.text && <p className="mt-0.5 text-slate-500">{it.text}</p>}
        </li>
      ))}
    </ul>
  )
}

function LegacyPointA({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: LegacyData }>(`/api/giga-admin/users/${userId}/point-a`)
  const d = data?.data

  if (loading && !d) return <Skeleton className="h-64" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!d) return null

  const diag = d.diagnostic
  const prev = d.history[1] ?? null
  const delta = diag?.overallScore != null && prev?.overallScore != null ? Math.round(diag.overallScore) - Math.round(prev.overallScore) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Точка А (диагностика)" value={round(diag?.overallScore ?? null)} hint={diag?.calculatedAt ? `рассчитана ${fmtDate(diag.calculatedAt)}${delta != null ? ` · ${delta > 0 ? '+' : ''}${delta} к прошлому` : ''}` : 'не рассчитана'} tone="green" />
        <StatTile label="Индекс здоровья" value={round(diag?.healthIndex ?? null)} hint={diag?.stage ? `стадия: ${STAGE[diag.stage] ?? diag.stage}` : undefined} tone="blue" />
        <StatTile label="GRI (текущий замер)" value={d.gri ? d.gri.index.toFixed(1) : '—'} hint={d.gri ? fmtDate(d.gri.assessedAt) : 'тест не пройден'} tone="violet" />
        <StatTile label="Расчётов Точки А" value={d.history.length} hint={diag?.aiStatus && diag.aiStatus !== 'completed' ? `разбор ИИ: ${diag.aiStatus}` : undefined} tone="amber" />
      </div>

      {!diag && (
        <Panel>
          <EmptyState title="Диагностика ещё не рассчитана" text="Клиент не прошёл диагностику или расчёт не сохранился." />
        </Panel>
      )}

      {diag && (
        <>
          <Panel title="Разбор ИИ" description="Краткое резюме, которое видит клиент">
            {diag.summary ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{diag.summary}</p> : <p className="text-xs text-slate-600">Разбор ещё не сгенерирован.</p>}
          </Panel>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {diag.blocks.map((b) => (
              <Panel key={b.id} title={b.label} actions={
                <span className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-slate-100">{round(b.score)}</span>
                  {b.status && <Badge tone={STATUS[b.status]?.tone}>{STATUS[b.status]?.label ?? b.status}</Badge>}
                </span>
              }>
                {!b.topIssues.length && !b.recommendations.length && <p className="text-xs text-slate-600">Деталей по блоку нет.</p>}
                {!!b.topIssues.length && (
                  <div className="mb-2">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-red-300/80">Проблемы</p>
                    <ul className="space-y-0.5 text-xs text-slate-300">{b.topIssues.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </div>
                )}
                {!!b.recommendations.length && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300/80">Рекомендации</p>
                    <ul className="space-y-0.5 text-xs text-slate-300">{b.recommendations.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </div>
                )}
              </Panel>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Риски"><Items items={diag.risks} empty="Рисков не выявлено или они не сохранены." /></Panel>
            <Panel title="Инсайты"><Items items={diag.insights} empty="Инсайтов нет." /></Panel>
            <Panel title="Быстрые победы"><Items items={diag.quickWins} empty="Быстрых побед нет." /></Panel>
          </div>

          {(!!diag.priorities.length || !!diag.dataGaps.length) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Стратегические приоритеты"><Items items={diag.priorities} empty="Приоритеты не сформулированы." /></Panel>
              <Panel title="Пробелы в данных" description="Чего не хватает для точной оценки"><Items items={diag.dataGaps} empty="Пробелов нет." /></Panel>
            </div>
          )}

          {!!diag.roadmap.length && (
            <div className="grid gap-3 lg:grid-cols-3">
              {diag.roadmap.map((r) => (
                <Panel key={r.key} title={`Дорожная карта: ${ROADMAP[r.key]}`}>
                  {!!r.goals.length && <ul className="mb-2 space-y-0.5 text-xs text-slate-200">{r.goals.map((g, i) => <li key={i}>◎ {g}</li>)}</ul>}
                  {!!r.actions.length && <ul className="space-y-0.5 text-xs text-slate-400">{r.actions.map((a, i) => <li key={i}>• {a}</li>)}</ul>}
                </Panel>
              ))}
            </div>
          )}

          {diag.industryContext && (
            <Panel title="Отраслевой контекст"><p className="text-sm leading-relaxed text-slate-300">{diag.industryContext}</p></Panel>
          )}
        </>
      )}

      {d.gri && !!d.gri.top5.length && (
        <Panel title="ТОП-5 ограничений роста (GRI)" description={`Замер от ${fmtDate(d.gri.assessedAt)}`}>
          <Items items={d.gri.top5} empty="" />
        </Panel>
      )}

      {d.history.length > 1 && (
        <Panel title="История расчётов (диагностика)">
          <ul className="divide-y divide-white/[0.05] text-xs">
            {d.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-1.5 text-slate-400">
                <span>{fmtDateTime(h.calculatedAt)}</span>
                <span className="tabular-nums text-slate-200">{round(h.overallScore)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
