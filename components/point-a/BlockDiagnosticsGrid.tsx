'use client'

/**
 * BlockDiagnosticsGrid — the five Point A blocks (Финансы / Продажи / Операции
 * / Маркетинг / Стратегия), each one expandable into the actual arithmetic.
 *
 * The card used to be a plain `<div>` with a hover animation: it showed
 * "0 / 100 · Критично" and offered no way to find out why. Now every card is a
 * disclosure button that opens the rule-by-rule breakdown — which survey
 * question was read, what the owner answered, and how many points that answer
 * contributed — plus the issues and recommendations the engine stored.
 *
 * The breakdown is computed by `./block-score-rules`, a mirror of
 * `lib/point-a-engine.ts`. The mirror's result is compared against the score
 * stored in the database and a mismatch is shown, never hidden.
 */

import Link from 'next/link'
import { useId, useState } from 'react'
import { explainBlock, labelOfKey, type BlockId, type Contribution } from './block-score-rules'

export interface DiagnosticBlock {
  id: BlockId
  label: string
  icon: string
  /** Score stored in `diagnostics.<block>_score`; null when it was never computed. */
  score: number | null
  topIssues: string[]
  recommendations: string[]
}

interface Props {
  blocks: DiagnosticBlock[]
  /** Survey answers keyed by question_key, already unwrapped from JSONB. */
  answers: Record<string, unknown>
  /** Whether the survey has any answers at all. */
  hasAnswers: boolean
}

const MAX = 100

function toneOf(score: number): { label: string; chip: string; bar: string } {
  if (score < 50) {
    return { label: 'Критично', chip: 'text-error border-error/20 bg-error/5', bar: 'bg-error' }
  }
  if (score >= 70) {
    return { label: 'Сильно', chip: 'text-primary border-primary/20 bg-primary/5', bar: 'bg-primary' }
  }
  return {
    label: 'Средне',
    chip: 'text-tertiary-container border-tertiary-container/20 bg-tertiary-container/5',
    bar: 'bg-tertiary-container',
  }
}

function ContributionRow({ c }: { c: Contribution }) {
  const positive = c.points > 0
  const negative = c.points < 0
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-bold text-on-surface leading-snug">{c.title}</p>
        <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
          <span className="text-on-surface-variant/60">Ответ: </span>
          {c.answer !== null ? (
            <span className="font-mono text-on-surface">{c.answer}</span>
          ) : (
            <span className="font-mono text-on-surface-variant/50">не заполнен</span>
          )}
        </p>
        <p className="text-[11px] text-on-surface-variant/70 mt-0.5 leading-snug">{c.note}</p>
        <p className="text-[10px] font-mono text-on-surface-variant/40 mt-1 truncate">
          {c.keys.map(labelOfKey).join(' · ')}
        </p>
      </div>
      <div className="text-right">
        <span
          className={`font-mono text-sm font-bold tabular-nums ${
            positive ? 'text-primary' : negative ? 'text-error' : 'text-on-surface-variant/50'
          }`}
        >
          {positive ? '+' : ''}
          {c.points}
        </span>
        <span className="block text-[10px] font-mono text-on-surface-variant/40 tabular-nums">
          из {c.max}
        </span>
      </div>
    </li>
  )
}

function BlockCard({
  block,
  answers,
  hasAnswers,
}: {
  block: DiagnosticBlock
  answers: Record<string, unknown>
  hasAnswers: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const hasScore = block.score !== null
  const score = block.score ?? 0
  const pct = (score / MAX) * 100
  const tone = toneOf(score)

  const explanation = explainBlock(block.id, answers)
  // The mirror and the stored value must agree; if they don't, say so.
  const mismatch = hasScore && explanation.clamped !== block.score
  const answeredCount = explanation.contributions.filter((c) => c.answer !== null).length

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] transition-colors hover:border-primary/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          hasScore
            ? `${block.label}: ${score} из ${MAX}, ${tone.label}. Показать, из чего сложился балл`
            : `${block.label}: балл не рассчитан. Показать, каких данных не хватает`
        }
        className="w-full text-left p-5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04]">
            <span className="material-symbols-outlined text-lg text-primary">{block.icon}</span>
          </div>
          {hasScore ? (
            <span
              className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${tone.chip}`}
            >
              {tone.label}
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.02] text-on-surface-variant">
              Нет расчёта
            </span>
          )}
        </div>

        <h3 className="text-sm font-bold text-on-surface mb-3">{block.label}</h3>

        <div className="flex items-end justify-between mb-2">
          <span
            className={`text-3xl font-mono font-bold ${
              hasScore ? 'text-on-surface' : 'text-on-surface-variant/40'
            }`}
          >
            {hasScore ? score : '—'}
          </span>
          <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-widest">
            / {MAX}
          </span>
        </div>

        <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
          {hasScore && (
            <div
              className={`h-full rounded-full transition-all duration-1000 ${tone.bar}`}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        <div className="mt-3 flex items-center gap-1 text-[11px] font-mono text-primary/80">
          <span className="material-symbols-outlined text-[14px]">
            {open ? 'expand_less' : 'expand_more'}
          </span>
          {open ? 'Свернуть разбор' : 'Из чего сложился балл'}
          <span className="ml-auto text-on-surface-variant/50">
            {answeredCount} из {explanation.contributions.length} ответов
          </span>
        </div>
      </button>

      <div id={panelId} hidden={!open} className="px-5 pb-5">
        <div className="rounded-xl bg-surface-container border border-white/[0.04] p-4">
          {!hasAnswers && (
            <p className="text-[11px] text-on-surface-variant leading-relaxed mb-3">
              Анкета пока не заполнена — движок считал блок по пустым ответам. Все нули
              ниже означают «нет данных», а не «плохой результат».
            </p>
          )}

          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-on-surface-variant/60 mb-1">
            Вопросы анкеты и их вклад
          </p>
          <ul className="mb-4">
            {explanation.contributions.map((c) => (
              <ContributionRow key={c.title} c={c} />
            ))}
          </ul>

          <div className="rounded-lg bg-surface-container-high px-3 py-2 text-[11px] font-mono text-on-surface-variant space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span>Сумма вкладов</span>
              <span className="text-on-surface tabular-nums">{explanation.raw}</span>
            </div>
            {explanation.raw !== explanation.clamped && (
              <div className="flex items-center justify-between gap-3">
                <span>После ограничения 0–100</span>
                <span className="text-on-surface tabular-nums">{explanation.clamped}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span>Вес блока в общем балле</span>
              <span className="text-on-surface tabular-nums">
                {Math.round(explanation.weight * 100)}%
              </span>
            </div>
            {hasScore && (
              <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/[0.06]">
                <span>Сохранено в диагностике</span>
                <span className="text-on-surface tabular-nums">{block.score}</span>
              </div>
            )}
          </div>

          {mismatch && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-400">
              <span className="material-symbols-outlined text-[14px] mt-px">warning</span>
              Разбор даёт {explanation.clamped}, а в диагностике сохранено {block.score}.
              Скорее всего, ответы менялись после последнего расчёта — нажмите
              «Пересчитать» в панели ниже.
            </p>
          )}

          {block.topIssues.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-error/70 mb-1.5">
                Что мешает
              </p>
              <ul className="space-y-1">
                {block.topIssues.map((issue, i) => (
                  <li key={`${i}-${issue}`} className="flex items-start gap-1.5 text-[11px] text-on-surface leading-snug">
                    <span className="w-1 h-1 rounded-full bg-error flex-shrink-0 mt-1.5" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {block.recommendations.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/70 mb-1.5">
                Что сделать
              </p>
              <ul className="space-y-1">
                {block.recommendations.map((rec, i) => (
                  <li key={`${i}-${rec}`} className="flex items-start gap-1.5 text-[11px] text-on-surface leading-snug">
                    <span className="material-symbols-outlined text-[12px] text-primary mt-px">
                      arrow_right
                    </span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link
            href="/client/onboarding"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Поправить ответы
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function BlockDiagnosticsGrid({ blocks, answers, hasAnswers }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {blocks.map((block) => (
        <BlockCard key={block.id} block={block} answers={answers} hasAnswers={hasAnswers} />
      ))}
    </div>
  )
}
