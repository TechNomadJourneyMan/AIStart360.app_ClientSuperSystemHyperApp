'use client'

/**
 * components/point-b/tabs/FinmodelTab.tsx — «Финмодель» (plan Ф3 Task 5, spec §7): the money of the
 * business that level 2 needs, in four groups. Each field has its label tied to the input, a hint
 * «где взять число», an origin badge and an error under the field. What is still missing is framed
 * with what it unlocks and the two ways to bring it: a file or the expert. Percent is typed as
 * percent and sent as a fraction (finmodelController); only changed fields are sent.
 *
 * Project tokens only — the PO will replace the design. Every state is local: loading → skeleton,
 * failure → a retry card, 402 → the Pro placeholder.
 */
import { useId } from 'react'
import Link from 'next/link'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { FINMODEL_DEFS, type FinmodelKey } from '@/lib/point-b/finmodel/keys'
import {
  NOTE_MAX, UNIT_LABEL, changedKeys, finmodelGroups, inputRange, isMissing, moneyPreview, originBadge, stateProgress,
  type FinmodelStateView, type FinmodelSnapshot, type OriginBadge,
} from '../finmodelController'
import { GAP_ACTIONS, TONE_CLASS } from '../overviewModel'
import PointBPaywall from '../PointBPaywall'
import { useFinmodel } from '../useFinmodel'
import { SectionSkeleton } from './OverviewTab'

const INPUT =
  'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 pr-14 text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60'
const INPUT_INVALID = 'border-error/60'

const BADGE_TONE: Record<OriginBadge['tone'], string> = {
  good: cn(TONE_CLASS.good.text, 'bg-primary/[0.1]'),
  warn: cn(TONE_CLASS.warn.text, 'bg-tertiary-fixed-dim/[0.1]'),
  neutral: 'bg-white/[0.06] text-on-surface-variant',
}

function FieldCard({ k, snap, onField }: { k: FinmodelKey; snap: FinmodelSnapshot; onField: (k: FinmodelKey, text: string) => void }) {
  const uid = useId()
  const def = FINMODEL_DEFS[k]
  const id = `${uid}-${k}`
  const text = snap.form[k]
  const error = snap.fieldErrors[k]
  const missing = isMissing(snap.state, k)
  const badge = originBadge(snap.state.values[k])
  const preview = moneyPreview(def, text)
  const range = inputRange(def)
  const describedBy = [`${id}-hint`, preview ? `${id}-preview` : null, error ? `${id}-err` : null].filter(Boolean).join(' ')

  return (
    <div className={cn('rounded-xl border p-3', missing ? 'border-tertiary-fixed-dim/40 bg-tertiary-fixed-dim/[0.05]' : 'border-white/[0.06] bg-white/[0.02]')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium text-on-surface">{def.label}</label>
        {badge && <span className={cn(CHIP, 'normal-case tracking-normal', BADGE_TONE[badge.tone])}>{badge.label}</span>}
      </div>
      <div className="relative mt-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={missing ? 'Не заполнено' : undefined}
          onChange={(e) => onField(k, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={snap.saving}
          className={cn(INPUT, error && INPUT_INVALID)}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-on-surface-variant">{UNIT_LABEL[def.unit]}</span>
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-on-surface-variant">{def.hint}</p>
      {preview && <p id={`${id}-preview`} className="mt-0.5 text-xs text-on-surface-variant">{preview}</p>}
      {def.unit !== '₸' && <p className="sr-only">Допустимо от {range.min} до {range.max}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-error">{error}</p>}
      {missing && (
        <div role="group" aria-label={`Нужно для расчёта денег: ${def.label}`} className="mt-3 rounded-lg border border-dashed border-tertiary-fixed-dim/40 p-2.5">
          <p className="text-xs font-semibold text-tertiary-fixed-dim">Нужно для расчёта денег</p>
          <p className="mt-0.5 text-xs text-on-surface-variant">После заполнения откроется: {def.unlocks}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={GAP_ACTIONS.documents.href} className={BTN_GHOST}>{GAP_ACTIONS.documents.label}</Link>
            <Link href={GAP_ACTIONS.expert.href} className={BTN_GHOST}>{GAP_ACTIONS.expert.label}</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Summary({ state }: { state: FinmodelStateView }) {
  const p = stateProgress(state)
  const assumed = state.defaulted.map((k) => FINMODEL_DEFS[k].label.toLowerCase())
  return (
    <section aria-labelledby="pb-fm-title" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pb-fm-title" className="font-headline text-lg font-bold text-on-surface">Финмодель</h2>
        <span className={cn(CHIP, state.complete ? 'bg-primary/[0.12] text-primary' : 'bg-white/[0.06] text-on-surface-variant')}>
          {state.complete ? 'Деньги считаются' : `Заполнено ${p.filled} из ${p.total}`}
        </span>
      </div>
      <p className="mt-1 text-sm text-on-surface-variant">
        Эти цифры нужны, чтобы считать не только выручку, но и деньги: прибыль и денежный поток отдельно, нехватку денег и резерв.
        Они не меняют баллы Точки А.
      </p>
      {!state.complete && (
        <p className="mt-2 text-xs text-on-surface-variant">
          Пока заполнено не всё, деньги не считаются: мы не подставляем нули вместо ваших цифр.
        </p>
      )}
      {assumed.length > 0 && (
        <p className="mt-2 text-xs text-tertiary-fixed-dim">
          Допущения по отрасли: {assumed.join(', ')}. Введите свои значения, и расчёт станет точнее.
        </p>
      )}
    </section>
  )
}

export interface FinmodelFormProps {
  snap: FinmodelSnapshot
  onField: (key: FinmodelKey, text: string) => void
  onNote: (text: string) => void
  onSave: () => void
  onRetry?: () => void
}

/** The form without a controller: the tab binds it, the tests render it. */
export function FinmodelFormView({ snap, onField, onNote, onSave, onRetry }: FinmodelFormProps) {
  const uid = useId()
  if (snap.phase === 'locked') return <PointBPaywall />
  if (snap.phase === 'loading') return <SectionSkeleton label="Загружаем финмодель" />
  if (snap.phase === 'error') {
    return (
      <section role="alert" className={cn(CARD, 'border-error/30 bg-error/[0.06]')}>
        <div className="flex items-start gap-3">
          <Icon name="error" className="mt-0.5 text-xl text-error" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">Не удалось загрузить финмодель</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">{snap.error}</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">Остальные вкладки при этом работают.</p>
            {onRetry && <button type="button" onClick={onRetry} className={cn(BTN_GHOST, 'mt-3')}>Повторить</button>}
          </div>
        </div>
      </section>
    )
  }

  const dirty = changedKeys(snap.form, snap.state).length > 0
  const noteErr = snap.fieldErrors.note
  const noteId = `${uid}-note`

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); onSave() }}
      noValidate
    >
      <Summary state={snap.state} />

      {finmodelGroups().map((g) => (
        <section key={g.id} aria-labelledby={`${uid}-${g.id}`} className="space-y-3">
          <h3 id={`${uid}-${g.id}`} className="font-headline text-base font-bold text-on-surface">{g.label}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {g.keys.map((k) => <FieldCard key={k} k={k} snap={snap} onField={onField} />)}
          </div>
        </section>
      ))}

      <section aria-label="Сохранение" className={cn(CARD, 'space-y-3')}>
        <div>
          <label htmlFor={noteId} className="text-sm font-medium text-on-surface">Комментарий к изменениям <span className="font-normal text-on-surface-variant">(по желанию)</span></label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={NOTE_MAX}
            value={snap.note}
            onChange={(e) => onNote(e.target.value)}
            disabled={snap.saving}
            aria-invalid={noteErr ? true : undefined}
            aria-describedby={noteErr ? `${noteId}-err` : undefined}
            className={cn(INPUT, 'mt-2 pr-3', noteErr && INPUT_INVALID)}
          />
          {noteErr && <p id={`${noteId}-err`} role="alert" className="mt-1 text-xs text-error">{noteErr}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={snap.saving || !dirty} className={BTN_PRIMARY}>
            {snap.saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <p role="status" aria-live="polite" className="text-xs">
            {snap.notice && <span className="text-primary">{snap.notice}</span>}
            {snap.saveError && <span role="alert" className="text-error">{snap.saveError}</span>}
            {!snap.notice && !snap.saveError && dirty && <span className="text-on-surface-variant">Есть несохранённые изменения</span>}
          </p>
        </div>
      </section>
    </form>
  )
}

export default function FinmodelTab({ onSaved, preview }: { onSaved?: () => void; preview?: FinmodelStateView }) {
  const { ctl, snap } = useFinmodel({ onSaved, preview })
  return (
    <FinmodelFormView
      snap={snap}
      onField={(k, t) => ctl.setField(k, t)}
      onNote={(t) => ctl.setNote(t)}
      onSave={() => void ctl.save()}
      onRetry={() => void ctl.load()}
    />
  )
}
