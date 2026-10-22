'use client'

/**
 * components/giga-panel/user360/point-b/RecommendationsPanel.tsx — the client's recommendations for the expert
 * (plan Ф6a Task 8, spec §12, §15.4): the list by status (на проверке / проверены / отклонены / требуют обновления)
 * with the source (правило / ИИ / эксперт); «Сгенерировать рекомендации ИИ», «Применить правила и инвайты»,
 * «Добавить свою»; per recommendation on review — «Подтвердить» (scope note pre-filled, comment), «Отклонить»
 * (a comment is required), «Править» (a new version that goes back on review). The client sees only what is verified.
 * Behaviour lives in recommendationsController.ts; this file only draws it.
 */
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, ListChecks, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { Badge, Button, ErrorState, Panel, Skeleton, cx, inputClass } from '../../kit'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import type { Recommendation } from '@/lib/point-b/recs/types'
import { fmtLongDate } from '@/components/point-b/overviewModel'
import { SOURCE_TYPE_LABEL } from '@/components/point-b/recsModel'
import {
  AI_WARNING_TEXT, CONFIDENCES, CONFIDENCE_LABEL, FIELD_LABEL, LIMITS, REC_KINDS, REC_KIND_LABEL, RecommendationsController, SOURCE_LABEL,
  groupByStatus, statusCounts, type FormValues, type RecForm, type RecsPanelSnapshot,
} from './recommendationsController'

const INVALID = 'border-red-500/50 focus:border-red-500/60'

const STATUS_TONE = { pending_review: 'amber', expert_verified: 'green', expert_rejected: 'red', stale: 'violet' } as const
const SOURCE_TONE = { rule: 'blue', ai: 'violet', expert: 'green' } as const

export interface RecommendationsPanelViewProps {
  snap: RecsPanelSnapshot
  onRetry: () => void
  onGenerate: () => void
  onRunRules: () => void
  onOpenForm: (mode: RecForm['mode'], recId?: string | null) => void
  onCloseForm: () => void
  onField: (field: keyof FormValues, value: string) => void
  onSubmit: () => void
}

function TextField({ uid, field, form, multiline = false, max, required = false, onField, hint }: {
  uid: string; field: keyof FormValues; form: RecForm; multiline?: boolean; max: number; required?: boolean; onField: RecommendationsPanelViewProps['onField']; hint?: string
}) {
  const id = `${uid}-${field}`
  const err = form.errors[field]
  const common = {
    id,
    value: form.values[field],
    maxLength: max,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': err ? `${id}-err` : hint ? `${id}-hint` : undefined,
    'aria-required': required || undefined,
    className: cx(inputClass, err && INVALID),
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-400">
        {FIELD_LABEL[field as keyof typeof FIELD_LABEL]}{required && <span aria-hidden className="text-red-300"> *</span>}
      </label>
      {multiline
        ? <textarea {...common} rows={3} onChange={(e) => onField(field, e.target.value)} />
        : <input {...common} type="text" autoComplete="off" onChange={(e) => onField(field, e.target.value)} />}
      {hint && !err && <p id={`${id}-hint`} className="mt-0.5 text-[10px] text-slate-600">{hint}</p>}
      {err && <p id={`${id}-err`} role="alert" className="mt-0.5 text-[11px] text-red-300">{err}</p>}
    </div>
  )
}

function SelectField({ uid, field, form, options, onField }: {
  uid: string; field: 'kind' | 'confidence'; form: RecForm; options: Array<{ value: string; label: string }>; onField: RecommendationsPanelViewProps['onField']
}) {
  const id = `${uid}-${field}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-400">{FIELD_LABEL[field]}</label>
      <select id={id} value={form.values[field]} onChange={(e) => onField(field, e.target.value)} className={inputClass}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

const FORM_TITLE: Record<RecForm['mode'], string> = {
  verify: 'Подтвердить рекомендацию',
  reject: 'Отклонить рекомендацию',
  edit: 'Править рекомендацию',
  create: 'Своя рекомендация',
}

const SUBMIT_LABEL: Record<RecForm['mode'], string> = {
  verify: 'Подтвердить',
  reject: 'Отклонить',
  edit: 'Сохранить как новую версию',
  create: 'Добавить',
}

function RecFormView({ form, p }: { form: RecForm; p: RecommendationsPanelViewProps }) {
  const uid = useId()
  const busy = p.snap.busy !== null
  const content = form.mode === 'edit' || form.mode === 'create'
  return (
    <form
      aria-label={FORM_TITLE[form.mode]}
      onSubmit={(e) => { e.preventDefault(); p.onSubmit() }}
      className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3"
    >
      <p className="text-xs font-semibold text-slate-200">{FORM_TITLE[form.mode]}</p>
      {form.mode === 'verify' && (
        <p className="text-[11px] text-slate-500">Клиент увидит рекомендацию с вашим именем, специализацией, датой и областью применимости.</p>
      )}
      {form.mode === 'edit' && (
        <p className="text-[11px] text-slate-500">Правка создаёт новую версию: она снова попадёт на проверку, а прежняя будет помечена «требует обновления».</p>
      )}
      {content && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {form.mode === 'create' && (
            <SelectField uid={uid} field="kind" form={form} options={REC_KINDS.map((k) => ({ value: k, label: REC_KIND_LABEL[k] }))} onField={p.onField} />
          )}
          <SelectField uid={uid} field="confidence" form={form} options={CONFIDENCES.map((c) => ({ value: c, label: CONFIDENCE_LABEL[c] }))} onField={p.onField} />
          <div className="sm:col-span-2"><TextField uid={uid} field="title" form={form} max={LIMITS.title} required onField={p.onField} /></div>
          <div className="sm:col-span-2"><TextField uid={uid} field="essence" form={form} max={LIMITS.text} required multiline onField={p.onField} /></div>
          <div className="sm:col-span-2"><TextField uid={uid} field="reason" form={form} max={LIMITS.text} required multiline onField={p.onField} /></div>
          <TextField uid={uid} field="expectedEffect" form={form} max={LIMITS.text} multiline onField={p.onField} />
          <TextField uid={uid} field="resources" form={form} max={LIMITS.text} multiline onField={p.onField} />
          <TextField uid={uid} field="confidenceReason" form={form} max={LIMITS.text} multiline onField={p.onField} />
          <TextField uid={uid} field="risks" form={form} max={LIMITS.text} multiline onField={p.onField} />
          <div className="sm:col-span-2"><TextField uid={uid} field="nextAction" form={form} max={LIMITS.text} onField={p.onField} /></div>
        </div>
      )}
      {(form.mode === 'verify' || form.mode === 'create') && (
        <TextField uid={uid} field="scopeNote" form={form} max={LIMITS.scope} required multiline onField={p.onField} hint="Для какого плана, сценария и каких данных верна рекомендация" />
      )}
      {form.mode !== 'edit' && (
        <TextField uid={uid} field="comment" form={form} max={LIMITS.comment} required={form.mode === 'reject'} multiline onField={p.onField} hint={form.mode === 'reject' ? 'Почему рекомендация не подходит — обязательно' : 'Необязательно'} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={form.mode === 'reject' ? 'danger' : 'primary'} loading={busy}>{SUBMIT_LABEL[form.mode]}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={p.onCloseForm}>Отмена</Button>
      </div>
    </form>
  )
}

function RecItem({ rec, p }: { rec: Recommendation; p: RecommendationsPanelViewProps }) {
  const busy = p.snap.busy !== null
  const form = p.snap.form?.recId === rec.id ? p.snap.form : null
  const reviewed = fmtLongDate(rec.reviewedAt)
  const rows: Array<[string, string | null]> = [
    [FIELD_LABEL.expectedEffect, rec.expectedEffect],
    [FIELD_LABEL.resources, rec.resources],
    [FIELD_LABEL.confidence, `${CONFIDENCE_LABEL[rec.confidence]}${rec.confidenceReason ? ` — ${rec.confidenceReason}` : ''}`],
    [FIELD_LABEL.risks, rec.risks],
    [FIELD_LABEL.nextAction, rec.nextAction],
  ]
  return (
    <li className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3" data-rec={rec.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[rec.status]}>{REC_KIND_LABEL[rec.kind]}</Badge>
        <Badge tone={SOURCE_TONE[rec.generatedBy]}>Источник: {SOURCE_LABEL[rec.generatedBy]}</Badge>
        <Badge>Версия {rec.recVersion}</Badge>
      </div>
      <p className="break-words text-sm font-semibold text-slate-100">{rec.title}</p>
      {rec.essence && <p className="break-words text-xs text-slate-300">{rec.essence}</p>}
      {rec.reason && <p className="break-words text-xs text-slate-400"><span className="text-slate-500">Причина: </span>{rec.reason}</p>}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Подробнее и источники</summary>
        <dl className="mt-2 space-y-1">
          {rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => (
            <div key={k}><dt className="inline text-slate-500">{k}: </dt><dd className="inline break-words text-slate-300">{v}</dd></div>
          ))}
        </dl>
        {rec.sourceRefs.length > 0 ? (
          <ul className="mt-2 space-y-0.5" aria-label="Источники">
            {rec.sourceRefs.map((s, i) => <li key={`${s.ref}-${i}`} className="text-slate-400">{SOURCE_TYPE_LABEL[s.type]}: <span className="text-slate-300">{s.label}</span></li>)}
          </ul>
        ) : <p className="mt-2 text-slate-500">Источники не указаны</p>}
      </details>
      {(rec.reviewerName || reviewed) && (
        <p className="text-[11px] text-slate-500">
          {rec.status === 'expert_rejected' ? 'Отклонил' : 'Проверил'}: {[rec.reviewerName, rec.reviewerSpecialty, reviewed].filter(Boolean).join(' · ')}
          {rec.scopeNote && <> · Область: {rec.scopeNote}</>}
          {rec.reviewComment && <> · Комментарий: {rec.reviewComment}</>}
        </p>
      )}
      {form ? <RecFormView form={form} p={p} /> : (
        <div className="flex flex-wrap gap-1.5">
          {rec.status === 'pending_review' && (
            <>
              <Button size="sm" variant="primary" icon={<Check size={12} />} disabled={busy} onClick={() => p.onOpenForm('verify', rec.id)}>Подтвердить</Button>
              <Button size="sm" variant="danger" icon={<X size={12} />} disabled={busy} onClick={() => p.onOpenForm('reject', rec.id)}>Отклонить</Button>
            </>
          )}
          {(rec.status === 'pending_review' || rec.status === 'expert_verified') && (
            <Button size="sm" icon={<Pencil size={12} />} disabled={busy} onClick={() => p.onOpenForm('edit', rec.id)}>Править</Button>
          )}
        </div>
      )}
    </li>
  )
}

export function RecommendationsPanelView(p: RecommendationsPanelViewProps) {
  const { snap } = p
  const groups = groupByStatus(snap.items)
  const counts = statusCounts(snap.items)
  const busy = snap.busy !== null
  const createForm = snap.form?.mode === 'create' ? snap.form : null

  return (
    <Panel
      title="Рекомендации клиента"
      description="Клиент видит только проверенные рекомендации — с вашим именем, датой и областью применимости. Неподтверждённые он видит лишь как счётчик."
      actions={(
        <>
          <Button size="sm" variant="primary" icon={<Sparkles size={12} />} loading={snap.busy === 'generate'} disabled={busy} onClick={p.onGenerate}>
            {snap.busy === 'generate' ? 'ИИ готовит рекомендации…' : 'Сгенерировать рекомендации ИИ'}
          </Button>
          <Button size="sm" icon={<ListChecks size={12} />} loading={snap.busy === 'rules'} disabled={busy} onClick={p.onRunRules}>Применить правила и инвайты</Button>
          <Button size="sm" icon={<Plus size={12} />} disabled={busy} onClick={() => p.onOpenForm('create')}>Добавить свою</Button>
        </>
      )}
      bodyClassName="space-y-3"
    >
      <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
        {AI_WARNING_TEXT}
      </p>

      <div aria-live="polite" className="space-y-2">
        {snap.busy === 'generate' && <p className="text-xs text-slate-400">Генерация идёт — обычно до минуты. Результат попадёт в очередь «На проверке».</p>}
        {snap.notice && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{snap.notice}</p>}
        {snap.error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{snap.error.message}</p>}
        {snap.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p className="font-medium">Предупреждения генерации</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{snap.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>

      {createForm && <RecFormView form={createForm} p={p} />}

      {snap.phase === 'loading' && <Skeleton className="h-24" />}
      {snap.phase === 'error' && <ErrorState error={{ message: snap.loadError ?? 'Не удалось загрузить рекомендации' }} onRetry={p.onRetry} />}
      {snap.phase === 'ready' && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs text-slate-500">
          Рекомендаций пока нет. Сгенерируйте их ИИ, примените правила или добавьте свою.
        </p>
      )}
      {snap.phase === 'ready' && groups.map((g) => (
        <section key={g.status} aria-label={g.label} className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            {g.label}
            <Badge tone={STATUS_TONE[g.status]}>{counts[g.status]}</Badge>
          </h3>
          <ul className="space-y-2">
            {g.items.map((r) => <RecItem key={r.id} rec={r} p={p} />)}
          </ul>
        </section>
      ))}
    </Panel>
  )
}

/** Stateful wrapper. `versions` (the plan of the client) fill the default scope note «Для плана vN, данные на …». */
export function RecommendationsPanel({ userId, versions = [] }: { userId: string; versions?: PlanVersionRow[] }) {
  const ctl = useMemo(() => new RecommendationsController(userId, (input, init) => fetch(input, init)), [userId])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)

  useEffect(() => { void ctl.load() }, [ctl])
  useEffect(() => {
    const numbers = Object.fromEntries(versions.map((v) => [v.id, v.version]))
    const current = versions.find((v) => v.status === 'approved')?.version ?? versions[0]?.version ?? null
    ctl.setVersions({ numbers, current })
  }, [ctl, versions])

  return (
    <RecommendationsPanelView
      snap={snap}
      onRetry={() => void ctl.load()}
      onGenerate={() => void ctl.generate()}
      onRunRules={() => void ctl.runRules()}
      onOpenForm={(mode, recId) => ctl.openForm(mode, recId ?? null)}
      onCloseForm={() => ctl.closeForm()}
      onField={(field, value) => ctl.setField(field, value)}
      onSubmit={() => void ctl.submitForm()}
    />
  )
}
