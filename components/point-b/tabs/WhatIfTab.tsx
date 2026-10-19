'use client'

/**
 * components/point-b/tabs/WhatIfTab.tsx — «Что если» (plan Ф4 Task 4, spec §9.5/§10): six calculators on the left,
 * the result on the right («Сейчас → При изменении → Δ», the chart, the contribution of every change, the
 * assumptions), then the saved scenarios. The tab only calculates: it never changes the plan; «Предложить
 * эксперту» sends a message and the expert decides.
 *
 * States: level 0 → an honest explanation with what is missing instead of calculators; a calculator the data does
 * not allow is greyed with the reason; money rows appear at level 2 only (otherwise a hint to the finmodel); 402 →
 * the Pro placeholder; «от имени» → the save / propose buttons are hidden. Labels are tied to inputs, hints and
 * errors are linked with aria-describedby, sliders carry a value text.
 *
 * Project tokens only — the PO will replace the design. Inputs are 16 px on a phone.
 */
import { useId } from 'react'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import type { MissingInput } from '@/lib/point-b/model/types'
import type { WhatIfKind, WhatIfResult } from '@/lib/point-b/model/whatif'
import DataGapBanner from '../DataGapBanner'
import PointBPaywall from '../PointBPaywall'
import { TONE_CLASS, fmtLongDate } from '../overviewModel'
import type { PointBStateSnapshot } from '../pointBStateController'
import { useWhatIf } from '../useWhatIf'
import type { WhatIfPreviewData, WhatIfSnapshot } from '../whatIfController'
import {
  CALCULATORS, LEVEL0_TEXT, MAX_SAVED, MONEY_LOCKED_TEXT, NAME_MAX, NOTE_MAX, WHATIF_DISCLAIMER, WHATIF_KINDS,
  compareRows, deltaLines, describeChanges, numberText, parseNumberText, savedDeltaLines, valueText,
  type CalculatorDef, type CardDraft, type CompareRow, type ParamDef, type SavedWhatIf,
} from '../whatIfModel'
import WhatIfChart from '../WhatIfChart'
import { SectionSkeleton } from './OverviewTab'
import { useGoToTab } from './PointBTabs'

const INPUT =
  'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60'
const INPUT_INVALID = 'border-error/60'

/** What the view calls; the controller satisfies it, the tests pass doubles. */
export interface WhatIfActions {
  setEnabled: (kind: WhatIfKind, enabled: boolean) => unknown
  setParam: (kind: WhatIfKind, key: string, text: string) => unknown
  resetCard: (kind: WhatIfKind) => unknown
  resetAll: () => unknown
  setName: (text: string) => unknown
  setNote: (text: string) => unknown
  save: () => unknown
  loadScenario: (id: string) => unknown
  remove: (id: string) => unknown
  openProposal: (id: string) => unknown
  closeProposal: () => unknown
  setProposalComment: (text: string) => unknown
  propose: (id: string) => unknown
  retrySaved: () => unknown
}

// ── Calculators ─────────────────────────────────────────────────────────

function ParamField({ kind, def, card, snap, actions }: { kind: WhatIfKind; def: ParamDef; card: CardDraft; snap: WhatIfSnapshot; actions: WhatIfActions }) {
  const uid = useId()
  const id = `${uid}-${kind}-${def.key}`
  const text = card.values[def.key] ?? ''
  const error = snap.cardErrors[kind]?.params[def.key]
  const parsed = parseNumberText(text)
  const sliderValue = Math.min(def.max, Math.max(def.min, parsed ?? def.default))
  const hasSlider = def.max - def.min <= 1_000_000
  const describedBy = [def.hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn(def.advanced && 'rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={id} className={cn('font-medium text-on-surface', def.advanced ? 'text-xs' : 'text-sm')}>{def.label}</label>
        <span className="text-xs text-on-surface-variant" aria-hidden>{valueText(def, text)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        {hasSlider && (
          <input
            type="range"
            aria-label={`${def.label}: ползунок`}
            min={def.min}
            max={def.max}
            step={def.step}
            value={sliderValue}
            aria-valuetext={valueText(def, numberText(sliderValue))}
            onChange={(e) => actions.setParam(kind, def.key, numberText(Math.round(Number(e.target.value) * 1e4) / 1e4))}
            className="h-6 min-w-0 flex-1 accent-primary"
          />
        )}
        <div className={cn('relative shrink-0', hasSlider ? 'w-28' : 'w-full')}>
          <input
            id={id}
            type="text"
            inputMode={def.min < 0 ? 'text' : 'decimal'}
            autoComplete="off"
            value={text}
            onChange={(e) => actions.setParam(kind, def.key, e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(INPUT, def.unit && 'pr-12', error && INPUT_INVALID)}
          />
          {def.unit && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-on-surface-variant">{def.unit}</span>}
        </div>
      </div>
      <p className="sr-only">Допустимо от {def.min} до {def.max}</p>
      {def.hint && <p id={`${id}-hint`} className="mt-1 text-xs text-on-surface-variant">{def.hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-error">{error}</p>}
    </div>
  )
}

function CalculatorCard({ def, snap, actions }: { def: CalculatorDef; snap: WhatIfSnapshot; actions: WhatIfActions }) {
  const uid = useId()
  const kind = def.kind
  const card = snap.draft[kind]
  const applicability = snap.applicable?.[kind] ?? null
  const available = applicability?.ok !== false
  const general = snap.cardErrors[kind]?.general
  const switchId = `${uid}-switch`
  const describedBy = [`${uid}-blurb`, !available ? `${uid}-reason` : null].filter(Boolean).join(' ')
  const main = def.params.filter((p) => !p.advanced)
  const extra = def.params.filter((p) => p.advanced)

  return (
    <li className={cn(CARD, 'space-y-3', !available && 'opacity-60', card.enabled && available && 'border-primary/30')}>
      <div className="flex items-start gap-3">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={card.enabled && available}
          disabled={!available}
          onChange={(e) => actions.setEnabled(kind, e.target.checked)}
          aria-describedby={describedBy}
          className="mt-1 h-5 w-5 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={switchId} className="font-headline text-base font-bold text-on-surface">{def.title}</label>
          <p id={`${uid}-blurb`} className="mt-0.5 text-xs text-on-surface-variant">{def.blurb}</p>
          {!available && (
            <p id={`${uid}-reason`} className="mt-1.5 flex items-start gap-1.5 text-xs text-tertiary-fixed-dim">
              <Icon name="lock" className="text-[14px]" />
              <span>Недоступно: {applicability?.reason ?? 'для ваших данных калькулятор не считается'}</span>
            </p>
          )}
        </div>
        {card.enabled && available && (
          <button type="button" onClick={() => actions.resetCard(kind)} aria-label={`Сбросить калькулятор «${def.title}»`} className={cn(BTN_GHOST, 'shrink-0')}>
            Сбросить
          </button>
        )}
      </div>

      {card.enabled && available && (
        <div className="space-y-3">
          {main.map((p) => <ParamField key={p.key} kind={kind} def={p} card={card} snap={snap} actions={actions} />)}
          {extra.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-on-surface-variant">Допущения калькулятора (можно изменить)</p>
              {extra.map((p) => <ParamField key={p.key} kind={kind} def={p} card={card} snap={snap} actions={actions} />)}
            </div>
          )}
          <p className="text-xs text-on-surface-variant">{def.assumption}</p>
          {general && <p role="alert" className="text-xs text-error">{general}</p>}
        </div>
      )}
    </li>
  )
}

// ── Result ──────────────────────────────────────────────────────────────

const BADGE_TONE = {
  good: TONE_CLASS.good,
  bad: TONE_CLASS.bad,
  warn: TONE_CLASS.warn,
  neutral: TONE_CLASS.neutral,
} as const

function ComparisonRow({ row }: { row: CompareRow }) {
  const tone = BADGE_TONE[row.tone]
  return (
    <li className="py-3">
      <p className="text-sm font-medium text-on-surface">{row.label}</p>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-on-surface-variant">Сейчас</dt>
          <dd className="text-sm text-on-surface">{row.now}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-on-surface-variant">При изменении</dt>
          <dd className="text-sm font-semibold text-on-surface">{row.changed}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-on-surface-variant">Изменение</dt>
          <dd className={cn('text-sm font-semibold', tone.text)}>{row.delta}</dd>
        </div>
      </dl>
      {row.note && <p className="mt-1 text-xs text-on-surface-variant">{row.note}</p>}
    </li>
  )
}

function MoneyLocked() {
  const go = useGoToTab()
  return (
    <li className="py-3">
      <p className="text-sm font-medium text-on-surface">Касса, кассовый разрыв, потребность в финансировании, операционная прибыль</p>
      <p className="mt-1 text-xs text-on-surface-variant">{MONEY_LOCKED_TEXT}: деньги считаются по вашим расходам, долгам и остаткам. Выручку и срок цели мы уже считаем.</p>
      <button type="button" onClick={() => go('finmodel')} className={cn(BTN_PRIMARY, 'mt-2')}>Заполнить финмодель</button>
    </li>
  )
}

function Lines({ lines, empty }: { lines: string[]; empty: string }) {
  if (!lines.length) return <span className="text-on-surface-variant">{empty}</span>
  return <>{lines.map((l, i) => <span key={i} className="block">{l}</span>)}</>
}

export function ResultPanel({ snap, level }: { snap: WhatIfSnapshot; level: number | null }) {
  const result: WhatIfResult | null = snap.result
  const busy = snap.calc === 'waiting' || snap.calc === 'loading'
  const rows = result ? compareRows(result) : []
  const moneyRows = rows.filter((r) => r.money)
  const mainRows = rows.filter((r) => !r.money)
  const resultLevel = result?.level ?? level ?? 0

  return (
    <section aria-labelledby="pb-wi-result" className={cn(CARD, 'space-y-4')} aria-busy={busy || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pb-wi-result" className="font-headline text-lg font-bold text-on-surface">Результат</h3>
        <p role="status" aria-live="polite" className="text-xs">
          {busy && <span className="text-on-surface-variant">Считаем…</span>}
          {snap.calc === 'invalid' && <span className="text-error">Исправьте значения в калькуляторах</span>}
          {snap.calc === 'error' && snap.calcError && <span role="alert" className="text-error">{snap.calcError}</span>}
        </p>
      </div>

      {!result && snap.calc !== 'error' && (
        <p className="text-sm text-on-surface-variant">
          Включите калькулятор слева и задайте изменение — здесь появится, как оно повлияет на выручку, срок цели и деньги. Сам план при этом не меняется.
        </p>
      )}

      {result && (
        <div className={cn('space-y-4', busy && 'opacity-60')}>
          <ul className="divide-y divide-white/[0.06]" aria-label="Сейчас, при изменении и разница">
            {mainRows.map((r) => <ComparisonRow key={r.id} row={r} />)}
            {resultLevel >= 2 ? moneyRows.map((r) => <ComparisonRow key={r.id} row={r} />) : <MoneyLocked />}
          </ul>

          <WhatIfChart series={result.series} />

          {result.riskFlags.length > 0 && (
            <ul aria-label="Риски" className="space-y-1.5">
              {result.riskFlags.map((f, i) => (
                <li key={i} className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm', TONE_CLASS.bad.border, TONE_CLASS.bad.bg, TONE_CLASS.bad.text)}>
                  <Icon name="warning" className="mt-0.5 text-[16px]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {result.explanation.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-on-surface">Что произойдёт</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-on-surface-variant">
                {result.explanation.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-on-surface">Вклад каждого изменения</h4>
            <ul className="mt-1.5 space-y-2">
              {result.contributions.map((c) => (
                <li key={c.kind} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm">
                  <p className="font-medium text-on-surface">{c.label}</p>
                  <p className="text-xs text-on-surface-variant"><Lines lines={deltaLines(c.delta, resultLevel === 2 ? 2 : 1)} empty="Заметного влияния нет" /></p>
                </li>
              ))}
              {result.contributions.length > 1 && (
                <li className="rounded-lg border border-dashed border-white/[0.1] px-3 py-2 text-sm">
                  <p className="font-medium text-on-surface">Эффект взаимодействия</p>
                  <p className="text-xs text-on-surface-variant"><Lines lines={deltaLines(result.interaction, resultLevel === 2 ? 2 : 1)} empty="Изменения почти не влияют друг на друга" /></p>
                  <p className="mt-1 text-xs text-on-surface-variant">Разница между совместным результатом и суммой отдельных вкладов: изменения усиливают или гасят друг друга, поэтому ничего не считается дважды.</p>
                </li>
              )}
            </ul>
          </div>

          {result.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-tertiary-fixed-dim">
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <details className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">Допущения</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-on-surface-variant">
              {result.assumptions.length > 0 ? result.assumptions.map((a, i) => <li key={i}>{a}</li>) : <li>Расчёт не перечислил допущений.</li>}
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}

// ── Saving and the saved list ───────────────────────────────────────────

function SavePanel({ snap, actions, hasChanges }: { snap: WhatIfSnapshot; actions: WhatIfActions; hasChanges: boolean }) {
  const uid = useId()
  const nameId = `${uid}-name`
  const noteId = `${uid}-note`
  const e = snap.saveErrors
  if (snap.readOnly) {
    return (
      <section aria-label="Сохранение сценария" className={CARD}>
        <p className="text-sm text-on-surface-variant">В режиме просмотра от имени пользователя сценарии не сохраняются и эксперту не отправляются.</p>
      </section>
    )
  }
  return (
    <form
      aria-label="Сохранение сценария"
      className={cn(CARD, 'space-y-3')}
      noValidate
      onSubmit={(ev) => { ev.preventDefault(); void actions.save() }}
    >
      <h3 className="font-headline text-base font-bold text-on-surface">Сохранить сценарий</h3>
      <div>
        <label htmlFor={nameId} className="text-sm font-medium text-on-surface">Название</label>
        <input
          id={nameId}
          type="text"
          maxLength={NAME_MAX}
          value={snap.name}
          onChange={(ev) => actions.setName(ev.target.value)}
          aria-invalid={e.name ? true : undefined}
          aria-describedby={e.name ? `${nameId}-err` : undefined}
          className={cn(INPUT, 'mt-1.5', e.name && INPUT_INVALID)}
        />
        {e.name && <p id={`${nameId}-err`} role="alert" className="mt-1 text-xs text-error">{e.name}</p>}
      </div>
      <div>
        <label htmlFor={noteId} className="text-sm font-medium text-on-surface">Комментарий <span className="font-normal text-on-surface-variant">(по желанию)</span></label>
        <textarea
          id={noteId}
          rows={2}
          maxLength={NOTE_MAX}
          value={snap.note}
          onChange={(ev) => actions.setNote(ev.target.value)}
          aria-invalid={e.note ? true : undefined}
          aria-describedby={e.note ? `${noteId}-err` : undefined}
          className={cn(INPUT, 'mt-1.5', e.note && INPUT_INVALID)}
        />
        {e.note && <p id={`${noteId}-err`} role="alert" className="mt-1 text-xs text-error">{e.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={snap.saving || !hasChanges} className={BTN_PRIMARY}>{snap.saving ? 'Сохраняем…' : 'Сохранить сценарий'}</button>
        <p role="status" aria-live="polite" className="text-xs">
          {snap.notice && <span className="text-primary">{snap.notice}</span>}
          {e.general && <span role="alert" className="text-error">{e.general}</span>}
          {!snap.notice && !e.general && !hasChanges && <span className="text-on-surface-variant">Сначала включите калькулятор</span>}
        </p>
      </div>
    </form>
  )
}

function SavedItem({ s, snap, actions }: { s: SavedWhatIf; snap: WhatIfSnapshot; actions: WhatIfActions }) {
  const uid = useId()
  const lines = savedDeltaLines(s)
  const date = fmtLongDate(s.createdAt)
  const proposed = fmtLongDate(s.proposedAt)
  const open = snap.proposal?.id === s.id
  const error = snap.rowErrors[s.id]
  const commentId = `${uid}-comment`
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">{s.name}</p>
          {date && <p className="text-xs text-on-surface-variant">{date}</p>}
        </div>
        {s.proposedAt && (
          <span className={cn(CHIP, 'bg-primary/[0.12] text-primary normal-case tracking-normal')}>
            <Icon name="check_circle" className="text-[14px]" />Предложено эксперту{proposed ? `, ${proposed}` : ''}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">{describeChanges(s.changes)}</p>
      {lines.length > 0 && <p className="mt-1 text-xs text-on-surface-variant">{lines.join(' · ')}</p>}
      {s.note && <p className="mt-1 text-xs text-on-surface-variant">Комментарий: {s.note}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => actions.loadScenario(s.id)} className={BTN_GHOST}>Загрузить</button>
        {!snap.readOnly && !s.proposedAt && !open && <button type="button" onClick={() => actions.openProposal(s.id)} className={BTN_GHOST}>Предложить эксперту</button>}
        {!snap.readOnly && <button type="button" onClick={() => actions.remove(s.id)} aria-label={`Удалить сценарий «${s.name}»`} className={BTN_GHOST}>Удалить</button>}
      </div>

      {open && (
        <form
          aria-label="Предложение эксперту"
          className="mt-3 space-y-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-3"
          noValidate
          onSubmit={(ev) => { ev.preventDefault(); void actions.propose(s.id) }}
        >
          <p className="text-xs text-on-surface-variant">Эксперт получит сообщение с этим сценарием. План не изменится, пока эксперт сам не решит его учесть.</p>
          <label htmlFor={commentId} className="text-sm font-medium text-on-surface">Комментарий для эксперта <span className="font-normal text-on-surface-variant">(по желанию)</span></label>
          <textarea id={commentId} rows={2} maxLength={NOTE_MAX} value={snap.proposal?.comment ?? ''} onChange={(ev) => actions.setProposalComment(ev.target.value)} className={INPUT} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={snap.proposing === s.id} className={BTN_PRIMARY}>{snap.proposing === s.id ? 'Отправляем…' : 'Отправить эксперту'}</button>
            <button type="button" onClick={() => actions.closeProposal()} className={BTN_GHOST}>Отмена</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
    </li>
  )
}

function SavedList({ snap, actions }: { snap: WhatIfSnapshot; actions: WhatIfActions }) {
  return (
    <section aria-labelledby="pb-wi-saved" className={cn(CARD, 'space-y-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pb-wi-saved" className="font-headline text-base font-bold text-on-surface">Сохранённые сценарии</h3>
        <span className="text-xs text-on-surface-variant">{snap.saved.length} из {MAX_SAVED}</span>
      </div>
      {snap.savedPhase === 'loading' && <p className="text-sm text-on-surface-variant">Загружаем…</p>}
      {snap.savedPhase === 'error' && (
        <div role="alert" className="text-sm text-error">
          <p>{snap.savedError}</p>
          <button type="button" onClick={() => actions.retrySaved()} className={cn(BTN_GHOST, 'mt-2')}>Повторить</button>
        </div>
      )}
      {snap.savedPhase === 'ready' && snap.saved.length === 0 && (
        <p className="text-sm text-on-surface-variant">Пока ничего не сохранено. Настройте калькуляторы и сохраните сценарий, чтобы вернуться к нему или предложить эксперту.</p>
      )}
      {snap.saved.length > 0 && (
        <ul className="space-y-2">
          {snap.saved.map((s) => <SavedItem key={s.id} s={s} snap={snap} actions={actions} />)}
        </ul>
      )}
    </section>
  )
}

// ── The tab ─────────────────────────────────────────────────────────────

export interface WhatIfViewProps {
  snap: WhatIfSnapshot
  actions: WhatIfActions
  /** The level the page already knows (state request), used until the first answer of the what-if request. */
  level: number | null
  /** The page state is still loading and nothing else says what the data allows. */
  loading?: boolean
  /** What the data lacks (for level 0). */
  missing: MissingInput[]
}

/** The tab without a controller: the tab binds it, the tests render it. */
export function WhatIfView({ snap, actions, level, loading, missing }: WhatIfViewProps) {
  if (snap.access === 'locked') return <PointBPaywall />
  const known = snap.level ?? level
  if (known === null && loading) return <SectionSkeleton label="Загружаем «Что если»" />

  const hasChanges = WHATIF_KINDS.some((k) => snap.draft[k].enabled)

  return (
    <div className="space-y-4">
      <section aria-labelledby="pb-wi-title" className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="pb-wi-title" className="font-headline text-lg font-bold text-on-surface">Что если</h2>
          {known !== 0 && hasChanges && <button type="button" onClick={() => actions.resetAll()} className={BTN_GHOST}>Сбросить всё</button>}
        </div>
        <p className="mt-1 text-sm text-on-surface-variant">
          Подвигайте параметры бизнеса и посмотрите, как изменятся выручка, срок цели и деньги.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-tertiary-fixed-dim">
          <Icon name="info" className="text-[14px]" />
          <span>{WHATIF_DISCLAIMER}</span>
        </p>
      </section>

      {known === 0 ? (
        <div className="space-y-4">
          <section aria-labelledby="pb-wi-l0" className={CARD}>
            <div className="flex items-start gap-3">
              <Icon name="calculate" className="mt-0.5 text-2xl text-secondary" />
              <div className="min-w-0">
                <h3 id="pb-wi-l0" className="text-sm font-semibold text-on-surface">Пока не из чего считать</h3>
                <p className="mt-1 text-sm text-on-surface-variant">{LEVEL0_TEXT}</p>
              </div>
            </div>
          </section>
          <DataGapBanner missing={missing} title="Чего не хватает для «Что если»" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <ul aria-label="Калькуляторы" className="space-y-3">
            {WHATIF_KINDS.map((k) => <CalculatorCard key={k} def={CALCULATORS[k]} snap={snap} actions={actions} />)}
          </ul>
          <div className="space-y-4">
            <ResultPanel snap={snap} level={known} />
          </div>
        </div>
      )}

      {known !== 0 && <SavePanel snap={snap} actions={actions} hasChanges={hasChanges} />}
      <SavedList snap={snap} actions={actions} />
    </div>
  )
}

export default function WhatIfTab({ state, preview }: { state: PointBStateSnapshot; preview?: WhatIfPreviewData }) {
  const { ctl, snap } = useWhatIf({ preview })
  return (
    <WhatIfView
      snap={snap}
      actions={{
        setEnabled: (k, v) => ctl.setEnabled(k, v),
        setParam: (k, key, t) => ctl.setParam(k, key, t),
        resetCard: (k) => ctl.resetCard(k),
        resetAll: () => ctl.resetAll(),
        setName: (t) => ctl.setName(t),
        setNote: (t) => ctl.setNote(t),
        save: () => ctl.save(),
        loadScenario: (id) => ctl.loadScenario(id),
        remove: (id) => ctl.remove(id),
        openProposal: (id) => ctl.openProposal(id),
        closeProposal: () => ctl.closeProposal(),
        setProposalComment: (t) => ctl.setProposalComment(t),
        propose: (id) => ctl.propose(id),
        retrySaved: () => ctl.loadSaved(),
      }}
      level={state.result?.level ?? null}
      loading={state.phase === 'loading'}
      missing={state.result?.missing ?? []}
    />
  )
}
