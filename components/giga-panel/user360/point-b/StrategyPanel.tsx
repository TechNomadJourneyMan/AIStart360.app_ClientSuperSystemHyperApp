'use client'

/**
 * components/giga-panel/user360/point-b/StrategyPanel.tsx — the expert's strategy editor inside a plan draft (plan Ф5
 * Task 6, spec §11): a tree «стратегия → инициатива → задача» with fields (title, description, owner, due date, impact and
 * effort, KPI, Point A block, metric, dependencies, delay risk), milestones, a preview of the impact × effort matrix and
 * «Сохранить стратегию». Editable in a draft only; in any other status the tree is shown read-only.
 * Behaviour lives in strategyController.ts; this file only draws it.
 *
 * Accessible: the tree has the tree/treeitem/group roles with aria-level and aria-expanded, every input has a label,
 * a mistake sits under its field (aria-invalid + aria-describedby), buttons that only carry an icon have a name.
 * Inputs are 16 px on a phone (no zoom on focus), buttons are at least 40 px tall.
 */
import { useId, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Flag, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Badge, Button, ConfirmDialog, Panel, cx } from '../../kit'
import MatrixChart from '@/components/point-b/MatrixChart'
import { DASH } from '@/components/point-b/overviewModel'
import { childrenOf, fmtDay, ratingText } from '@/components/point-b/strategyModel'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import type { MatrixPoint } from '@/lib/point-b/strategy/matrix'
import type { Milestone, PlanStrategy, StrategyKind, StrategyNode } from '@/lib/point-b/strategy/types'
import {
  CHILD_KIND, KIND_NOM, KIND_ONE, STRATEGY_LIMITS, canAdd, dependencyCandidates, limitRows, parseNumberInput,
  type MilestonePatch, type NodePatch, type StrategyEditor, type StrategySnapshot,
} from './strategyController'
import { useStrategyEditor } from './useStrategyEditor'

const CHILD_PLURAL: Record<StrategyKind, string> = { strategy: 'Стратегии', initiative: 'Инициативы', task: 'Задачи' }
const INPUT = 'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-base text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none sm:text-sm'
const INVALID = 'border-red-500/50 focus:border-red-500/60'
const ICON_BTN = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 transition-colors hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40'

export interface StrategyActions {
  addStrategy: () => void
  addChild: (kind: StrategyKind, parentKey: string) => void
  update: (key: string, patch: NodePatch) => void
  updateKpi: (key: string, patch: { name?: string; target?: number | null; unit?: string | null }) => void
  addDependency: (key: string, depKey: string) => void
  removeDependency: (key: string, depKey: string) => void
  move: (key: string, dir: 'up' | 'down') => void
  requestRemove: (key: string) => void
  cancelRemove: () => void
  confirmRemove: () => void
  toggleExpanded: (key: string) => void
  toggleEditing: (key: string) => void
  addMilestone: () => void
  updateMilestone: (key: string, patch: MilestonePatch) => void
  removeMilestone: (key: string) => void
  save: () => void
}

export function actionsOf(ctl: StrategyEditor): StrategyActions {
  return {
    addStrategy: () => void ctl.addStrategy(),
    addChild: (kind, parentKey) => void ctl.add(kind, parentKey),
    update: (k, p) => ctl.update(k, p),
    updateKpi: (k, p) => ctl.updateKpi(k, p),
    addDependency: (k, d) => void ctl.addDependency(k, d),
    removeDependency: (k, d) => ctl.removeDependency(k, d),
    move: (k, d) => ctl.move(k, d),
    requestRemove: (k) => ctl.requestRemove(k),
    cancelRemove: () => ctl.cancelRemove(),
    confirmRemove: () => ctl.confirmRemove(),
    toggleExpanded: (k) => ctl.toggleExpanded(k),
    toggleEditing: (k) => ctl.toggleEditing(k),
    addMilestone: () => void ctl.addMilestone(),
    updateMilestone: (k, p) => ctl.updateMilestone(k, p),
    removeMilestone: (k) => ctl.removeMilestone(k),
    save: () => void ctl.save(),
  }
}

// ── Fields ──────────────────────────────────────────────────────────────

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-400">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-0.5 text-[10px] text-slate-600">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-0.5 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

const describedBy = (id: string, error?: string, hint?: string): string | undefined => (error ? `${id}-err` : hint ? `${id}-hint` : undefined)

function TextField({ id, label, value, onChange, error, hint, multiline, type = 'text', maxLength, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string
  multiline?: boolean; type?: 'text' | 'date'; maxLength?: number; placeholder?: string
}) {
  const common = {
    id, value, maxLength, placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, error, hint),
    className: cx(INPUT, error && INVALID),
  }
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      {multiline ? <textarea {...common} rows={3} /> : <input {...common} type={type} />}
    </Field>
  )
}

/** A number typed by a person: what is typed stays on the screen; only a readable number is passed on. */
function NumberField({ id, label, value, onChange, error, hint }: {
  id: string; label: string; value: number | null; onChange: (v: number | null) => void; error?: string; hint?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [bad, setBad] = useState(false)
  const shown = bad ? 'Введите число, например 120 или 2,5' : error
  return (
    <Field id={id} label={label} error={shown} hint={hint}>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        onChange={(e) => {
          setText(e.target.value)
          const r = parseNumberInput(e.target.value)
          setBad(!r.ok)
          if (r.ok) onChange(r.value)
        }}
        aria-invalid={shown ? true : undefined}
        aria-describedby={describedBy(id, shown, hint)}
        className={cx(INPUT, shown && INVALID)}
      />
    </Field>
  )
}

function RatingSelect({ id, label, value, onChange, error }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; error?: string }) {
  return (
    <Field id={id} label={label} error={error} hint="1 — малое, 5 — очень большое">
      <select
        id={id}
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, 'h')}
        className={cx(INPUT, error && INVALID)}
      >
        <option value="">Не оценено</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  )
}

// ── One node ────────────────────────────────────────────────────────────

interface TreeProps { uid: string; snap: StrategySnapshot; actions: StrategyActions; editable: boolean }

function Dependencies({ uid, node, snap, actions }: { uid: string; node: StrategyNode } & Pick<TreeProps, 'snap' | 'actions'>) {
  const id = `${uid}-${node.key}-dep`
  const error = snap.errors.nodes[node.key]?.dependsOn
  const items = snap.strategy.items
  const byKey = new Map(items.map((n) => [n.key, n]))
  const candidates = dependencyCandidates(items, node.key)
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-400">Зависит от (только узлы того же уровня)</label>
      {node.dependsOn.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Выбранные зависимости">
          {node.dependsOn.map((d) => {
            const name = byKey.get(d)?.title || DASH
            return (
              <li key={d} className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] py-0.5 pl-2.5 pr-1 text-xs text-slate-200">
                <span className="min-w-0 truncate">{name}</span>
                <button type="button" onClick={() => actions.removeDependency(node.key, d)} aria-label={`Убрать зависимость от «${name}»`} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                  <X size={12} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <select
        id={id}
        value=""
        disabled={candidates.length === 0}
        onChange={(e) => { if (e.target.value) actions.addDependency(node.key, e.target.value) }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cx(INPUT, error && INVALID)}
      >
        <option value="">{candidates.length === 0 ? 'Выбрать некого' : 'Добавить зависимость…'}</option>
        {candidates.map((c) => <option key={c.key} value={c.key}>{c.title || DASH}</option>)}
      </select>
      {error && <p id={`${id}-err`} role="alert" className="mt-0.5 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

function NodeForm({ uid, node, snap, actions }: { uid: string; node: StrategyNode } & Pick<TreeProps, 'snap' | 'actions'>) {
  const f = (name: string) => `${uid}-${node.key}-${name}`
  const err = snap.errors.nodes[node.key] ?? {}
  const rated = node.kind !== 'task'
  return (
    <div id={`${uid}-${node.key}-form`} className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      {err.node && <p role="alert" className="text-[11px] text-red-300">{err.node}</p>}
      <TextField id={f('title')} label={`Название (${KIND_NOM[node.kind].toLowerCase()})`} value={node.title} maxLength={STRATEGY_LIMITS.title} error={err.title} onChange={(v) => actions.update(node.key, { title: v })} placeholder="Коротко и по делу" />
      <TextField id={f('description')} label="Описание" value={node.description ?? ''} multiline maxLength={STRATEGY_LIMITS.description} error={err.description} onChange={(v) => actions.update(node.key, { description: v })} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField id={f('owner')} label="Ответственный" value={node.ownerLabel ?? ''} maxLength={200} error={err.ownerLabel} onChange={(v) => actions.update(node.key, { ownerLabel: v })} hint="Имя или роль — попадёт в план действий клиента" />
        <TextField id={f('due')} label="Срок" type="date" value={node.dueDate ?? ''} error={err.dueDate} onChange={(v) => actions.update(node.key, { dueDate: v })} />
      </div>
      {rated && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RatingSelect id={f('impact')} label="Влияние" value={node.impact} error={err.impact} onChange={(v) => actions.update(node.key, { impact: v })} />
          <RatingSelect id={f('effort')} label="Усилие" value={node.effort} error={err.effort} onChange={(v) => actions.update(node.key, { effort: v })} />
        </div>
      )}
      {rated && (
        <fieldset className="rounded-xl border border-white/[0.06] p-3" aria-describedby={err.kpi ? f('kpi-err') : undefined}>
          <legend className="px-1 text-[11px] font-medium text-slate-400">Измеримый результат (KPI)</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField id={f('kpi-name')} label="Показатель" value={node.kpi?.name ?? ''} maxLength={200} onChange={(v) => actions.updateKpi(node.key, { name: v })} placeholder="Например, повторные покупки" />
            <NumberField id={f('kpi-target')} label="Цель" value={node.kpi?.target ?? null} onChange={(v) => actions.updateKpi(node.key, { target: v })} />
            <TextField id={f('kpi-unit')} label="Единица" value={node.kpi?.unit ?? ''} maxLength={40} onChange={(v) => actions.updateKpi(node.key, { unit: v })} placeholder="%, ₸, шт." />
          </div>
          {err.kpi && <p id={f('kpi-err')} role="alert" className="mt-1 text-[11px] text-red-300">{err.kpi}</p>}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField id={f('block')} label="Блок Точки А" value={node.block ?? ''} maxLength={200} error={err.block} onChange={(v) => actions.update(node.key, { block: v })} hint="Ключ блока — для связи, без расчётов" />
        {rated && <TextField id={f('metric')} label="Метрика реестра" value={node.metricId ?? ''} maxLength={200} error={err.metricId} onChange={(v) => actions.update(node.key, { metricId: v })} hint="Ключ метрики — для связи, без расчётов" />}
      </div>
      <Dependencies uid={uid} node={node} snap={snap} actions={actions} />
      {rated && <TextField id={f('risk')} label="Риск задержки" value={node.delayRisk ?? ''} multiline maxLength={STRATEGY_LIMITS.description} error={err.delayRisk} onChange={(v) => actions.update(node.key, { delayRisk: v })} />}
    </div>
  )
}

function Summary({ node }: { node: StrategyNode }) {
  const bits = [
    node.kind !== 'task' && node.impact !== null ? ratingText('Влияние', node.impact) : null,
    node.kind !== 'task' && node.effort !== null ? ratingText('Усилие', node.effort) : null,
    node.dueDate ? `срок ${fmtDay(node.dueDate)}` : null,
    node.ownerLabel,
  ].filter(Boolean)
  return bits.length ? <span className="block text-[11px] text-slate-500">{bits.join(' · ')}</span> : null
}

function TreeNode({ node, level, uid, snap, actions, editable }: { node: StrategyNode; level: number } & TreeProps) {
  const items = snap.strategy.items
  const childKind = CHILD_KIND[node.kind]
  const kids = childKind ? childrenOf(items, node.key, childKind) : []
  const siblings = childrenOf(items, node.parentKey, node.kind)
  const idx = siblings.findIndex((n) => n.key === node.key)
  const open = snap.expanded.has(node.key)
  const editing = snap.editing.has(node.key)
  const hasError = Object.keys(snap.errors.nodes[node.key] ?? {}).length > 0
  const name = node.title || `Без названия (${KIND_NOM[node.kind].toLowerCase()})`

  return (
    <li role="treeitem" aria-level={level} aria-expanded={childKind ? open : undefined} aria-selected={false} className="space-y-2">
      <div className={cx('flex flex-wrap items-center gap-2 rounded-xl border bg-white/[0.02] p-2', hasError ? 'border-red-500/40' : 'border-white/[0.06]')}>
        {childKind ? (
          <button type="button" onClick={() => actions.toggleExpanded(node.key)} aria-expanded={open} aria-label={`${open ? 'Свернуть' : 'Развернуть'}: ${name}`} className={ICON_BTN}>
            <ChevronRight size={16} aria-hidden className={cx('transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="w-2" aria-hidden />}
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={node.kind === 'strategy' ? 'violet' : node.kind === 'initiative' ? 'blue' : 'neutral'}>{KIND_NOM[node.kind]}</Badge>
            <span className={cx('min-w-0 break-words text-sm', node.title ? 'font-medium text-slate-100' : 'italic text-slate-500')}>{name}</span>
          </span>
          <Summary node={node} />
          {hasError && !editing && <span className="block text-[11px] text-red-300">Есть ошибка — откройте поля</span>}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" className="min-h-[40px]" icon={<Pencil size={12} aria-hidden />} aria-expanded={editing} aria-controls={`${uid}-${node.key}-form`} onClick={() => actions.toggleEditing(node.key)}>
              {editing ? 'Свернуть поля' : 'Изменить'}
            </Button>
            <button type="button" className={ICON_BTN} disabled={idx <= 0} onClick={() => actions.move(node.key, 'up')} aria-label={`Выше: ${name}`}><ArrowUp size={14} aria-hidden /></button>
            <button type="button" className={ICON_BTN} disabled={idx < 0 || idx >= siblings.length - 1} onClick={() => actions.move(node.key, 'down')} aria-label={`Ниже: ${name}`}><ArrowDown size={14} aria-hidden /></button>
            <button type="button" className={cx(ICON_BTN, 'hover:text-red-300')} onClick={() => actions.requestRemove(node.key)} aria-label={`Удалить: ${name}`}><Trash2 size={14} aria-hidden /></button>
          </div>
        )}
      </div>

      {editable && editing && <NodeForm uid={uid} node={node} snap={snap} actions={actions} />}

      {childKind && open && (
        <ul role="group" aria-label={`${CHILD_PLURAL[childKind]} — ${name}`} className="ml-3 space-y-2 border-l border-white/[0.08] pl-3 sm:ml-5 sm:pl-4">
          {kids.map((k) => <TreeNode key={k.key} node={k} level={level + 1} uid={uid} snap={snap} actions={actions} editable={editable} />)}
          {kids.length === 0 && !editable && <li role="none" className="text-[11px] text-slate-600">Пусто</li>}
          {editable && (
            <li role="none">
              <Button size="sm" className="min-h-[40px]" icon={<Plus size={12} aria-hidden />} disabled={!canAdd(snap.strategy, childKind)} onClick={() => actions.addChild(childKind, node.key)}>
                Добавить {KIND_ONE[childKind]}
              </Button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

// ── Milestones ──────────────────────────────────────────────────────────

function MilestoneRow({ m, uid, snap, actions, editable }: { m: Milestone } & TreeProps) {
  const f = (name: string) => `${uid}-ms-${m.key}-${name}`
  const err = snap.errors.milestones[m.key] ?? {}
  if (!editable) {
    return (
      <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-sm text-slate-200">
        <span className="font-medium">{m.title || DASH}</span>
        <span className="text-slate-500"> · {fmtDay(m.date)}{m.kpi ? ` · KPI: ${m.kpi}` : ''}</span>
      </li>
    )
  }
  return (
    <li className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem]">
        <TextField id={f('title')} label="Название контрольной точки" value={m.title} maxLength={STRATEGY_LIMITS.title} error={err.title} onChange={(v) => actions.updateMilestone(m.key, { title: v })} />
        <TextField id={f('date')} label="Дата" type="date" value={m.date} error={err.date} onChange={(v) => actions.updateMilestone(m.key, { date: v })} />
      </div>
      <TextField id={f('kpi')} label="KPI на эту дату" value={m.kpi ?? ''} maxLength={200} error={err.kpi} onChange={(v) => actions.updateMilestone(m.key, { kpi: v })} placeholder="Например, 200 участников программы" />
      <TextField id={f('description')} label="Описание" value={m.description ?? ''} multiline maxLength={STRATEGY_LIMITS.description} error={err.description} onChange={(v) => actions.updateMilestone(m.key, { description: v })} />
      <Button size="sm" className="min-h-[40px]" icon={<Trash2 size={12} aria-hidden />} onClick={() => actions.removeMilestone(m.key)} aria-label={`Удалить контрольную точку: ${m.title || 'без названия'}`}>Удалить точку</Button>
    </li>
  )
}

// ── The panel ───────────────────────────────────────────────────────────

export interface StrategyPanelViewProps {
  snap: StrategySnapshot
  actions: StrategyActions
  /** The version is a draft. */
  editable: boolean
  versionNumber: number | null
  matrix: { points: MatrixPoint[]; unrated: number }
}

export function StrategyPanelView({ snap, actions, editable, versionNumber, matrix }: StrategyPanelViewProps) {
  const uid = useId()
  const s: PlanStrategy = snap.strategy
  const roots = childrenOf(s.items, null, 'strategy')
  const rows = limitRows(s)
  const pending = snap.pendingRemove

  return (
    <Panel
      title={`Стратегия и дорожная карта${versionNumber !== null ? ` · версия ${versionNumber}` : ''}`}
      description={editable
        ? 'Дерево «стратегия → инициатива → задача». Клиент увидит его только после одобрения версии; задачи тогда появятся в его плане действий.'
        : 'Версия не черновик, стратегию в ней менять нельзя — для правок создайте новую версию.'}
      actions={editable ? (
        <Button size="sm" variant="primary" icon={<Save size={12} aria-hidden />} loading={snap.busy} disabled={snap.busy || !snap.dirty} onClick={actions.save}>Сохранить стратегию</Button>
      ) : <Badge tone="neutral">Только чтение</Badge>}
    >
      <div className="space-y-5">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500" aria-label="Лимиты">
          {rows.map((r) => <li key={r.kind} className={cx(r.used >= r.max && 'text-amber-300')}>{r.label}: {r.used} из {r.max}</li>)}
        </ul>

        <div aria-live="polite" className="space-y-2">
          {snap.notice && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{snap.notice}</p>}
          {snap.errors.general && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{snap.errors.general}</p>}
          {snap.serverError && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{snap.serverError.message}</p>}
          {snap.dirty && !snap.busy && <p className="text-[11px] text-amber-300">Есть несохранённые изменения.</p>}
        </div>

        {roots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-slate-500">
            {editable ? 'Стратегии пока нет. Добавьте первую — затем инициативы и задачи.' : 'В этой версии стратегии нет.'}
          </p>
        ) : (
          <ul role="tree" aria-label="Дерево стратегии" className="space-y-2">
            {roots.map((r) => <TreeNode key={r.key} node={r} level={1} uid={uid} snap={snap} actions={actions} editable={editable} />)}
          </ul>
        )}
        {editable && (
          <Button size="sm" className="min-h-[40px]" icon={<Plus size={12} aria-hidden />} disabled={!canAdd(s, 'strategy')} onClick={actions.addStrategy}>Добавить стратегию</Button>
        )}

        <section aria-labelledby={`${uid}-ms`} className="space-y-2">
          <h3 id={`${uid}-ms`} className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><Flag size={13} aria-hidden />Контрольные точки</h3>
          {s.milestones.length === 0 ? (
            <p className="text-[11px] text-slate-500">Контрольных точек нет.</p>
          ) : (
            <ul className="space-y-2" aria-label="Контрольные точки">
              {s.milestones.map((m) => <MilestoneRow key={m.key} m={m} uid={uid} snap={snap} actions={actions} editable={editable} />)}
            </ul>
          )}
          {editable && <Button size="sm" className="min-h-[40px]" icon={<Plus size={12} aria-hidden />} disabled={!canAdd(s, 'milestone')} onClick={actions.addMilestone}>Добавить контрольную точку</Button>}
        </section>

        <section aria-labelledby={`${uid}-mx`} className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <h3 id={`${uid}-mx`} className="text-xs font-semibold text-slate-200">Предпросмотр матрицы «влияние × усилие»</h3>
          <p className="text-[11px] text-slate-500">Так её увидит клиент. В матрицу попадают стратегии и инициативы, у которых оценены и влияние, и усилие.</p>
          <MatrixChart matrix={matrix} />
        </section>

        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
            <span className="text-[11px] text-slate-500">{snap.dirty ? 'Изменения ещё не сохранены' : 'Всё сохранено'}</span>
            <Button variant="primary" icon={<Save size={14} aria-hidden />} loading={snap.busy} disabled={snap.busy || !snap.dirty} onClick={actions.save}>Сохранить стратегию</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pending}
        onClose={actions.cancelRemove}
        onConfirm={actions.confirmRemove}
        title={`Удалить ${pending ? KIND_ONE[pending.kind] : ''}?`}
        text={pending
          ? `«${pending.title || 'Без названия'}»${pending.descendants > 0 ? ` будет удалена вместе со всем, что внутри (${pending.descendants} ${pending.descendants === 1 ? 'узел' : 'узлов'}).` : ' будет удалена.'} Это ещё не сохранено — изменение применится после «Сохранить стратегию».`
          : undefined}
        confirmLabel="Удалить"
      />
    </Panel>
  )
}

/** Stateful wrapper: one editor per version of the open plan (draft: editable; in review or approved: read-only). */
export function StrategyPanel({ userId, version, onSaved }: { userId: string; version: PlanVersionRow; onSaved?: () => void }) {
  const editable = version.status === 'draft'
  const { ctl, snap } = useStrategyEditor(userId, version.id, version.strategy, editable, onSaved)
  return (
    <StrategyPanelView snap={snap} actions={actionsOf(ctl)} editable={editable} versionNumber={version.version} matrix={ctl.matrix()} />
  )
}
