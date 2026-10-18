'use client'

/**
 * components/giga-panel/user360/point-b/FinmodelPanel.tsx — the client's «Финмодель» for the expert
 * (plan Ф3 Task 6, spec §15.4): every key with its value, origin and status; the expert edits a value
 * (saved as the expert's) and ticks the values he has checked → «Подтвердить выбранные». Values from
 * the questionnaire / the platform and the industry assumptions cannot be ticked. A mismatch of the
 * model with the fact (a warning of the calculation) is shown on top. Behaviour lives in
 * finmodelPanelController.ts; this file only draws it.
 */
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import { BadgeCheck, Save } from 'lucide-react'
import { Badge, Button, ErrorState, Panel, Skeleton, cx, inputClass } from '../../kit'
import { FINMODEL_DEFS, type FinmodelKey } from '@/lib/point-b/finmodel/keys'
import {
  NOTE_MAX, UNIT_LABEL, canVerify, changedKeys, finmodelGroups, moneyPreview, originBadge, stateProgress,
} from '@/components/point-b/finmodelController'
import { fmtLongDate } from '@/components/point-b/overviewModel'
import {
  FinmodelPanelController, isMismatchWarning, rowStatus, verifiableSelection, type PanelSnapshot,
} from './finmodelPanelController'

const INVALID = 'border-red-500/50 focus:border-red-500/60'

export interface FinmodelPanelViewProps {
  snap: PanelSnapshot
  onField: (key: FinmodelKey, text: string) => void
  onNote: (text: string) => void
  onToggle: (key: FinmodelKey) => void
  onSave: () => void
  onVerify: () => void
  onRetry: () => void
}

function Row({ k, p, uid }: { k: FinmodelKey; p: FinmodelPanelViewProps; uid: string }) {
  const { snap } = p
  const def = FINMODEL_DEFS[k]
  const v = snap.state.values[k]
  const id = `${uid}-${k}`
  const error = snap.fieldErrors[k]
  const edited = changedKeys(snap.form, snap.state).includes(k)
  const status = rowStatus(snap.state, k)
  const badge = originBadge(v, 'expert')
  const tickable = canVerify(v) && !edited
  const when = fmtLongDate(v?.updatedAt ?? null)
  const preview = moneyPreview(def, snap.form[k])
  const busy = snap.busy !== null
  const why = !v ? 'Нет сохранённого значения' : v.status === 'verified' ? 'Уже проверено' : !canVerify(v) ? 'Подставлено автоматически или принято по отрасли: подтверждать нечего' : edited ? 'Сначала сохраните правку' : ''

  return (
    <tr className="border-b border-white/[0.04] align-top">
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          aria-label={`Подтвердить «${def.label}»`}
          title={why || undefined}
          checked={snap.selected.includes(k)}
          disabled={!tickable || busy}
          onChange={() => p.onToggle(k)}
          className="mt-2 h-4 w-4 accent-blue-500"
        />
      </td>
      <td className="py-2 pr-3">
        <label htmlFor={id} className="text-xs font-medium text-slate-200">{def.label}</label>
        {snap.state.missing.includes(k) && <p className="text-[11px] text-red-300">Нужно для уровня 2</p>}
        {v?.note && <p className="mt-0.5 text-[11px] text-slate-500">Комментарий: {v.note}</p>}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={snap.form[k]}
            placeholder="—"
            disabled={busy}
            onChange={(e) => p.onField(k, e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : preview ? `${id}-prev` : undefined}
            className={cx(inputClass, 'min-w-[7rem] !py-1.5 !text-xs', error && INVALID)}
          />
          <span className="shrink-0 text-[11px] text-slate-500">{UNIT_LABEL[def.unit]}</span>
        </div>
        {preview && !error && <p id={`${id}-prev`} className="mt-0.5 text-[11px] text-slate-500">{preview}</p>}
        {error && <p id={`${id}-err`} role="alert" className="mt-0.5 text-[11px] text-red-300">{error}</p>}
      </td>
      <td className="py-2 pr-3 text-[11px] text-slate-400">
        {badge ? badge.label : '—'}
        {when && v && v.status !== 'verified' && v.origin !== 'default' && <span className="block text-slate-600">{when}</span>}
      </td>
      <td className="py-2"><Badge tone={status.tone} title={status.hint}>{status.label}</Badge></td>
    </tr>
  )
}

export function FinmodelPanelView(p: FinmodelPanelViewProps) {
  const uid = useId()
  const { snap } = p
  if (snap.phase === 'loading') return <Panel title="Финмодель клиента"><Skeleton className="h-40 w-full" /></Panel>
  if (snap.phase === 'error') return <Panel title="Финмодель клиента"><ErrorState error={{ message: snap.error ?? 'Не удалось загрузить финмодель' }} onRetry={p.onRetry} /></Panel>

  const progress = stateProgress(snap.state)
  const dirty = changedKeys(snap.form, snap.state).length > 0
  const ready = verifiableSelection(snap.state, snap.form, snap.selected).length
  const noteErr = snap.fieldErrors.note
  const noteId = `${uid}-note`
  const busy = snap.busy !== null
  const mismatches = snap.warnings.filter(isMismatchWarning)
  const others = snap.warnings.filter((w) => !isMismatchWarning(w))

  return (
    <Panel
      title="Финмодель клиента"
      description="Проверка допущений: деньги, расходы, долги, оборотный капитал и налог. Правка сохраняется как значение эксперта."
      actions={
        <>
          <Badge tone={snap.state.complete ? 'green' : 'amber'}>{snap.state.complete ? 'Уровень данных: 2' : `Заполнено ${progress.filled} из ${progress.total}`}</Badge>
          <Button size="sm" variant="primary" icon={<BadgeCheck size={12} />} loading={snap.busy === 'verify'} disabled={busy || ready === 0} onClick={p.onVerify}>
            Подтвердить выбранные{ready > 0 ? ` (${ready})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div aria-live="polite" className="space-y-2">
          {snap.notice && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{snap.notice}</p>}
          {snap.actionError && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{snap.actionError}</p>}
        </div>

        {mismatches.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
            <p className="font-semibold">Модель расходится с фактом</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{mismatches.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <p className="mt-1 text-amber-200/80">Сверьте постоянные расходы и ФОТ с отчётностью клиента.</p>
          </div>
        )}
        {others.length > 0 && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p className="font-medium">Предупреждения расчёта</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{others.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {snap.state.defaulted.length > 0 && (
          <p className="text-[11px] text-amber-200/80">
            Допущения по отрасли: {snap.state.defaulted.map((k) => FINMODEL_DEFS[k].label.toLowerCase()).join(', ')}. Диапазон расчёта с ними шире — введите значения клиента.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <caption className="sr-only">Входы финмодели клиента: значение, происхождение и статус проверки</caption>
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] text-slate-500">
                <th scope="col" className="w-8 py-2 pr-2 font-medium"><span className="sr-only">Подтвердить</span></th>
                <th scope="col" className="py-2 pr-3 font-medium">Показатель</th>
                <th scope="col" className="py-2 pr-3 font-medium">Значение</th>
                <th scope="col" className="py-2 pr-3 font-medium">Происхождение</th>
                <th scope="col" className="py-2 font-medium">Статус</th>
              </tr>
            </thead>
            {finmodelGroups().map((g) => (
              <tbody key={g.id}>
                <tr><th scope="rowgroup" colSpan={5} className="pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</th></tr>
                {g.keys.map((k) => <Row key={k} k={k} p={p} uid={uid} />)}
              </tbody>
            ))}
          </table>
        </div>

        <div>
          <label htmlFor={noteId} className="mb-1 block text-[11px] font-medium text-slate-400">Комментарий к правкам (по желанию)</label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={NOTE_MAX}
            value={snap.note}
            disabled={busy}
            onChange={(e) => p.onNote(e.target.value)}
            aria-invalid={noteErr ? true : undefined}
            aria-describedby={noteErr ? `${noteId}-err` : undefined}
            className={cx(inputClass, noteErr && INVALID)}
          />
          {noteErr && <p id={`${noteId}-err`} role="alert" className="mt-0.5 text-[11px] text-red-300">{noteErr}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<Save size={12} />} loading={snap.busy === 'save'} disabled={busy || !dirty} onClick={p.onSave}>Сохранить правки</Button>
          {dirty && <span className="text-[11px] text-slate-500">Есть несохранённые правки</span>}
        </div>
      </div>
    </Panel>
  )
}

/** Stateful wrapper: the controller bound to the panel. */
export function FinmodelPanel({ userId }: { userId: string }) {
  const ctl = useMemo(() => new FinmodelPanelController(userId, (input, init) => fetch(input, init)), [userId])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return (
    <FinmodelPanelView
      snap={snap}
      onField={(k, t) => ctl.setField(k, t)}
      onNote={(t) => ctl.setNote(t)}
      onToggle={(k) => ctl.toggle(k)}
      onSave={() => void ctl.save()}
      onVerify={() => void ctl.verify()}
      onRetry={() => void ctl.load()}
    />
  )
}
