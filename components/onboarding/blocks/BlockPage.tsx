'use client'

import Link from 'next/link'
import { QuestionField } from '@/components/onboarding/shared/QuestionField'
import { FieldCalc } from '@/components/survey/FieldCalc'
import { CalcTracker } from '@/components/onboarding/CalcTracker'
import { TwinOffer } from '@/components/onboarding/express/TwinOffer'
import { questionsOfPlace, type SurveyBlock } from '@/lib/survey/questions'
import { blockCalcIds, blockProgress, blockProgressText, type BlockImpact } from '@/lib/survey/blocks'
import { twinOffer } from '@/lib/survey/twins'

export interface BlockPageProps {
  block: SurveyBlock
  answers: Readonly<Record<string, unknown>>
  onChange: (key: string, value: unknown) => void
  /** Explicit save (then Point A is recalculated by the queue). */
  onSave: () => void
  next: SurveyBlock | null
  onNext: () => void
  saving?: boolean
  /** «Что изменилось в Точке А»: the linked v4 blocks (null = Point A not read yet). */
  impact: readonly BlockImpact[] | null
  /** A recalculation with the new answers is running. */
  recalculating?: boolean
  fieldIssue?: { key: string; message: string } | null
}

const pct = (x: number) => `${Math.round(x * 100)} %`

/**
 * One deepening block (spec 2026-10-23 §7.4): «зачем → что получите», time,
 * progress; its questions from the registry (QuestionField — tables and files
 * link to the full questionnaire); twin offers; the block's calculations;
 * «Что изменилось в Точке А»; «Следующий блок».
 */
export function BlockPage({ block, answers, onChange, onSave, next, onNext, saving = false, impact, recalculating = false, fieldIssue }: BlockPageProps) {
  const questions = questionsOfPlace(block.id)
  const progress = blockProgress(block, answers)
  const calcs = blockCalcIds(block)
  return (
    <article aria-labelledby={`block-${block.id}`} className="space-y-6" data-block-page={block.id}>
      <header className="space-y-2">
        <Link href="/client/onboarding/blocks" className="inline-flex min-h-[32px] items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_back</span>Все блоки
        </Link>
        <h1 id={`block-${block.id}`} className="font-headline text-2xl font-bold text-on-surface">{block.title}</h1>
        <p className="text-xs leading-snug text-on-surface-variant">
          <span className="font-semibold">Зачем:</span> {block.why} → <span className="font-semibold">что получите:</span> {block.gives}
        </p>
        <p className="text-[11px] font-mono text-on-surface-variant/80">~{block.minutes} мин · {blockProgressText(progress)}</p>
      </header>

      <div className="space-y-6">
        {questions.map((q) => {
          const offer = twinOffer(q.key, answers)
          return (
            <div key={q.key} className="space-y-2">
              {offer && <TwinOffer offer={offer} onAccept={() => onChange(q.key, offer.value)} onEdit={() => document.getElementById(q.key)?.focus()} />}
              <QuestionField question={q} value={answers[q.key]} onChange={(v) => onChange(q.key, v)} />
              {fieldIssue?.key === q.key && <p role="alert" className="text-xs text-error">{fieldIssue.message}</p>}
            </div>
          )
        })}
      </div>

      {calcs.length > 0 && <CalcTracker><FieldCalc ids={calcs} answers={answers} /></CalcTracker>}

      <section aria-labelledby={`impact-${block.id}`} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 id={`impact-${block.id}`} className="text-sm font-semibold text-on-surface">Что изменилось в Точке А</h2>
        {impact === null ? (
          <p className="mt-2 text-xs text-on-surface-variant">Загружаем Точку А…</p>
        ) : impact.length === 0 ? (
          <p className="mt-2 text-xs text-on-surface-variant">Этот блок — материал для эксперта и разбора: на баллы Точки А он не влияет.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {impact.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-on-surface">{b.title}</span>
                <span className="text-on-surface-variant">
                  полнота {pct(b.coverage)} · {b.score === null ? <span className="text-amber-200">данных не хватает</span> : <b className="text-on-surface">{b.score}</b>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-on-surface-variant/70" aria-live="polite">
          {recalculating ? 'Пересчитываем Точку А с новыми ответами — обычно пара минут…' : 'После сохранения Точка А пересчитывается сама — обычно за пару минут.'}
        </p>
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-white/[0.06] bg-[#0c0e14]/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
        <button type="button" onClick={onSave} disabled={saving} className="min-h-[48px] flex-1 rounded-xl border border-primary/30 bg-primary/[0.06] text-sm font-semibold text-primary hover:bg-primary/[0.12] disabled:opacity-50">
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {next && (
          <button type="button" onClick={onNext} disabled={saving} className="min-h-[48px] flex-1 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-sm font-bold text-[#003824] disabled:opacity-50">
            Следующий блок: {next.title}
          </button>
        )}
      </div>
    </article>
  )
}
