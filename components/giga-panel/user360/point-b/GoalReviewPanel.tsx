'use client'

/**
 * components/giga-panel/user360/point-b/GoalReviewPanel.tsx — verification of the owner's
 * goals by the expert: the status of every goal, «Подтвердить» and «Исправить» (value,
 * deadline, reason). A correction of a goal the owner already set is a PROPOSAL: the goal
 * stays as it is until the owner agrees («ждёт согласия владельца»). Behaviour lives in
 * planController.ts (shared with the plan panel: a verified goal unlocks the approval).
 */
import { useId, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { Badge, Button, EmptyState, Field, Panel, Skeleton, cx, inputClass } from '../../kit'
import type { PlanGoalItem } from '@/lib/point-b/plan/types'
import { GOAL_STATUS_INFO, fmtNumber, type PlanController, type PlanSnapshot, type UiError } from './planController'

const INVALID = 'border-red-500/50 focus:border-red-500/60'
const goalKey = (g: { metricKey: string; periodLabel: string }) => `${g.metricKey}|${g.periodLabel}`

export interface CorrectionForm { value: string; deadline: string; reason: string }

function GoalRow({ g, primary, form, error, busy, onVerify, onOpen, onChange, onCancel, onSubmit }: {
  g: PlanGoalItem
  primary: boolean
  form: CorrectionForm | null
  error: UiError | null
  busy: string | null
  onVerify: () => void
  onOpen: () => void
  onChange: (f: CorrectionForm) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const uid = useId()
  const info = GOAL_STATUS_INFO[g.reviewStatus] ?? GOAL_STATUS_INFO.owner_draft
  const mine = busy === `goal:${g.metricKey}`
  const done = g.reviewStatus === 'verified' || g.reviewStatus === 'agreed'
  const bad = (field: string) => error?.field === field && !!form
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">
            {g.label ?? g.metricKey}
            {primary && <Badge tone="blue" className="ml-2">Главная цель</Badge>}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Период {g.periodLabel}
            {g.baselineValue !== null && <> · сейчас {fmtNumber(g.baselineValue)}</>}
            {' '}· цель <span className="text-slate-300">{fmtNumber(g.targetValue)}</span>
            {g.deadline && <> · до {g.deadline}</>}
          </p>
        </div>
        <Badge tone={info.tone} title={info.hint}>{info.label}</Badge>
      </div>

      {!form && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<Check size={12} />} loading={mine} disabled={(!!busy && !mine) || done} onClick={onVerify}>
            Подтвердить
          </Button>
          <Button size="sm" icon={<Pencil size={12} />} disabled={!!busy} onClick={onOpen}>Исправить</Button>
        </div>
      )}

      {g.reviewStatus === 'corrected' && !form && (
        <p className="mt-2 text-[11px] text-slate-500">Предложение отправлено владельцу. Пока он не ответил, цель не меняется.</p>
      )}
      {g.reviewStatus === 'disputed' && !form && (
        <p className="mt-2 text-[11px] text-red-300/80">Владелец оспорил исправление: подтвердите его цель или предложите другое значение.</p>
      )}

      {form && (
        <div className="mt-3 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Новое значение цели">
              <input
                type="number"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => onChange({ ...form, value: e.target.value })}
                aria-invalid={bad('value') || undefined}
                aria-describedby={bad('value') ? `${uid}-err` : undefined}
                className={cx(inputClass, bad('value') && INVALID)}
              />
            </Field>
            <Field label="Срок (необязательно)">
              <input type="date" value={form.deadline} onChange={(e) => onChange({ ...form, deadline: e.target.value })} className={inputClass} />
            </Field>
          </div>
          <Field label="Причина — её увидит владелец">
            <textarea
              value={form.reason}
              onChange={(e) => onChange({ ...form, reason: e.target.value })}
              rows={3}
              maxLength={1000}
              aria-invalid={bad('reason') || undefined}
              aria-describedby={bad('reason') ? `${uid}-err` : undefined}
              className={cx(inputClass, bad('reason') && INVALID)}
            />
          </Field>
          {error && (bad('value') || bad('reason') || (!error.field && error.status >= 400)) && (
            <p id={`${uid}-err`} role="alert" className="text-[11px] text-red-300">{error.message}</p>
          )}
          <p className="text-[11px] text-slate-500">
            Если владелец цель уже задал, это предложение: цель изменится только после его согласия.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={mine}>Отмена</Button>
            <Button size="sm" variant="primary" loading={mine} onClick={onSubmit}>Отправить исправление</Button>
          </div>
        </div>
      )}
    </li>
  )
}

export interface GoalReviewPanelViewProps {
  snap: PlanSnapshot
  forms: Record<string, CorrectionForm>
  onVerify: (g: PlanGoalItem) => void
  onOpen: (g: PlanGoalItem) => void
  onChange: (g: PlanGoalItem, f: CorrectionForm) => void
  onCancel: (g: PlanGoalItem) => void
  onSubmit: (g: PlanGoalItem) => void
}

export function GoalReviewPanelView(p: GoalReviewPanelViewProps) {
  const { snap } = p
  const goals = snap.plan?.goals
  const items = goals?.items ?? []
  const mine = snap.scope === 'goal'
  const anyForm = Object.keys(p.forms).length > 0
  // A server error with no open form (e.g. a failed «Подтвердить») is shown on the panel.
  const general = mine && snap.error && !anyForm && snap.busy === null && items.length > 0 ? snap.error : null
  return (
    <Panel
      title="Цели клиента"
      description="Главная цель должна быть подтверждена, прежде чем версию плана можно будет одобрить."
    >
      {snap.phase === 'loading' && <Skeleton className="h-16" />}
      {snap.phase === 'ready' && items.length === 0 && (
        <EmptyState
          title="Целей пока нет"
          text="Когда владелец поставит цель, она появится здесь на проверку. Клиент увидит предварительный расчёт без плана эксперта."
        />
      )}
      {snap.phase === 'ready' && items.length > 0 && (
        <ul className="space-y-2" aria-label="Цели клиента">
          {items.map((g) => (
            <GoalRow
              key={goalKey(g)}
              g={g}
              primary={!!goals?.primary && goals.primary.metricKey === g.metricKey && goals.primary.periodLabel === g.periodLabel}
              form={p.forms[goalKey(g)] ?? null}
              error={mine ? snap.error : null}
              busy={snap.busy}
              onVerify={() => p.onVerify(g)}
              onOpen={() => p.onOpen(g)}
              onChange={(f) => p.onChange(g, f)}
              onCancel={() => p.onCancel(g)}
              onSubmit={() => p.onSubmit(g)}
            />
          ))}
        </ul>
      )}
      <div aria-live="polite">
        {mine && snap.notice && <p className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{snap.notice}</p>}
      </div>
      {general && <p role="alert" className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{general.message}</p>}
    </Panel>
  )
}

export function GoalReviewPanel({ ctl, snap }: { ctl: PlanController; snap: PlanSnapshot }) {
  const [forms, setForms] = useState<Record<string, CorrectionForm>>({})
  const drop = (g: PlanGoalItem) => setForms((s) => { const n = { ...s }; delete n[goalKey(g)]; return n })

  return (
    <GoalReviewPanelView
      snap={snap}
      forms={forms}
      onVerify={(g) => void ctl.reviewGoal({ metricKey: g.metricKey, periodLabel: g.periodLabel, action: 'verify' })}
      onOpen={(g) => setForms((s) => ({ ...s, [goalKey(g)]: { value: String(g.targetValue), deadline: g.deadline ?? '', reason: '' } }))}
      onChange={(g, f) => setForms((s) => ({ ...s, [goalKey(g)]: f }))}
      onCancel={drop}
      onSubmit={async (g) => {
        const f = forms[goalKey(g)]
        if (!f) return
        const ok = await ctl.reviewGoal({
          metricKey: g.metricKey,
          periodLabel: g.periodLabel,
          action: 'correct',
          value: f.value.trim() === '' ? Number.NaN : Number(f.value),
          deadline: f.deadline || null,
          reason: f.reason,
        })
        if (ok) drop(g)
      }}
    />
  )
}
