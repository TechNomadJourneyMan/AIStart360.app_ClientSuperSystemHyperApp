'use client'

import { useId, type ReactNode } from 'react'
import { QuestionField } from '@/components/onboarding/shared/QuestionField'
import { FieldCalc, FIELD_CALC_CAPTION } from '@/components/survey/FieldCalc'
import { CalcTracker } from '@/components/onboarding/CalcTracker'
import { TwinOffer } from './TwinOffer'
import { EXPRESS_SCREEN_CALCS, EXPRESS_TOTAL_SCREENS, EXPRESS_WHY, canFinishExpress, type ExpressPage } from '@/lib/survey/express'
import { marginMoney } from '@/lib/survey/snapshot'
import { twinOffer } from '@/lib/survey/twins'

export interface ExpressScreenProps {
  page: ExpressPage
  answers: Readonly<Record<string, unknown>>
  onChange: (key: string, value: unknown) => void
  onBack?: () => void
  onNext: () => void
  onSkip: () => void
  onFinish: () => void
  /** The last page of the flow: «Готово — показать снимок» is the main button. */
  last: boolean
  busy?: boolean
  /** A refused answer (profanity) next to its question. */
  fieldIssue?: { key: string; message: string } | null
  /** «Нашли в документах» chips for the screen (DocumentSuggestions). */
  suggestions?: ReactNode
}

const BTN = 'min-h-[48px] rounded-xl px-4 text-sm transition-colors disabled:opacity-50'

/**
 * One express screen (spec 2026-10-23 §7.1, §14.3–14.4): «Экран 5 из 15»,
 * the question as the heading (fields named by it), «зачем», the fields from
 * the registry (yes / no without a default, «не знаю», «примерно»), the
 * twin offer, calculations after screens 5, 11, 14, 15 and the bottom bar —
 * «Далее» stays at the bottom on a phone. «Пропустить» never blocks «Готово».
 */
export function ExpressScreen({ page, answers, onChange, onBack, onNext, onSkip, onFinish, last, busy = false, fieldIssue, suggestions }: ExpressScreenProps) {
  const titleId = useId()
  const single = page.questions.length === 1
  const lastPart = !page.part || page.part.index === page.part.total
  const calcs = lastPart ? EXPRESS_SCREEN_CALCS[page.screen] : undefined
  const margin = lastPart && page.screen === 15 ? marginMoney(answers) : null
  const finishable = canFinishExpress(page)

  return (
    <section aria-labelledby={titleId} className="space-y-5" data-express-screen={page.screen}>
      <div className="space-y-1.5">
        <p className="text-[11px] font-mono uppercase tracking-wider text-primary/80">
          Экран {page.screen} из {EXPRESS_TOTAL_SCREENS}
          {page.part && <span className="text-on-surface-variant"> · вопрос {page.part.index} из {page.part.total}</span>}
        </p>
        <h2 id={titleId} className="font-headline text-xl font-bold leading-snug text-on-surface">
          {single ? (page.questions[0].plain ?? page.title) : page.title}
        </h2>
        {EXPRESS_WHY[page.screen] && (
          <p className="text-xs leading-snug text-on-surface-variant">
            <span className="font-semibold text-on-surface-variant">Зачем: </span>{EXPRESS_WHY[page.screen]}
          </p>
        )}
      </div>

      {suggestions}

      <div className="space-y-6">
        {page.questions.map((q) => {
          const offer = twinOffer(q.key, answers)
          return (
            <div key={q.key} className="space-y-2">
              {offer && <TwinOffer offer={offer} onAccept={() => onChange(q.key, offer.value)} onEdit={() => document.getElementById(q.key)?.focus()} />}
              <QuestionField
                question={q}
                value={answers[q.key]}
                onChange={(v) => onChange(q.key, v)}
                labelledBy={single ? titleId : undefined}
                why={null}
              />
              {fieldIssue?.key === q.key && <p role="alert" className="text-xs text-error">{fieldIssue.message}</p>}
            </div>
          )
        })}
      </div>

      {(calcs || margin) && (
        <CalcTracker>
          {calcs && <FieldCalc ids={calcs} answers={answers} />}
          {margin && (
            <section data-calc="margin_money" className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant/70">Маржа и деньги · {FIELD_CALC_CAPTION}</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-on-surface">{margin.line}</p>
              <p className="mt-1 text-[11px] text-on-surface-variant/70">{margin.note}</p>
            </section>
          )}
        </CalcTracker>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-white/[0.06] bg-[#0c0e14]/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} disabled={busy} className={`${BTN} border border-white/[0.08] text-on-surface-variant hover:bg-white/[0.04]`} aria-label="Назад">
              <span className="material-symbols-outlined text-base align-middle" aria-hidden="true">arrow_back</span>
            </button>
          )}
          {!last && (
            <button type="button" onClick={onSkip} disabled={busy} className={`${BTN} text-on-surface-variant hover:text-on-surface`}>
              Пропустить
            </button>
          )}
          {last ? (
            <button type="button" onClick={onFinish} disabled={busy} className={`${BTN} flex-1 bg-gradient-to-r from-primary to-[#00e29e] font-bold text-[#003824]`}>
              {busy ? 'Сохраняем…' : 'Готово — показать снимок'}
            </button>
          ) : (
            <button type="button" onClick={onNext} disabled={busy} className={`${BTN} flex-1 bg-gradient-to-r from-primary to-[#00e29e] font-bold text-[#003824]`}>
              {busy ? 'Сохраняем…' : 'Далее'}
            </button>
          )}
        </div>
        {finishable && !last && (
          <button type="button" onClick={onFinish} disabled={busy} className="mt-2 w-full min-h-[44px] rounded-xl border border-primary/30 bg-primary/[0.06] text-sm font-semibold text-primary hover:bg-primary/[0.12] disabled:opacity-50">
            Готово — показать снимок
          </button>
        )}
      </div>
    </section>
  )
}
