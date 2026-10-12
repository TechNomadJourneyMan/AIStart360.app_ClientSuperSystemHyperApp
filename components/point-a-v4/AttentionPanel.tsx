'use client'

/**
 * «Требует внимания»: open data discrepancies with quick decisions (spec §5)
 * and the top of «что загрузить». Hidden when there is nothing to do.
 */
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PointAPageState } from '@/hooks/usePointAState'
import { useResolveDiscrepancy } from '@/hooks/usePointAState'
import { BTN_GHOST, BTN_PRIMARY, CARD, Icon, SectionTitle, fmtValue } from './ui'
import { cn } from '@/lib/utils'

const SOURCE_RU: Record<string, string> = { survey: 'Анкета', document: 'Документ', manual: 'Вручную', integration: 'Интеграция', assessment: 'Оценка GRI' }

type Disc = PointAPageState['discrepancies'][number]

function CustomValue({ d, onDone }: { d: Disc; onDone: () => void }) {
  const resolve = useResolveDiscrepancy()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const submit = async () => {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(n)) return toast.error('Введите число')
    try {
      await resolve.mutateAsync({ id: d.id, body: { choice: 'custom', value: n, note: note.trim() || undefined } })
      toast.success('Значение сохранено — Точка А пересчитается')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <label>
        <span className="sr-only">Верное значение</span>
        <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Верное значение${d.candidates[0]?.unit ? `, ${d.candidates[0].unit}` : ''}`}
          className="w-full rounded-xl border border-white/10 bg-surface-container-low px-3 py-2 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50" />
      </label>
      <label>
        <span className="sr-only">Комментарий</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (необязательно)"
          className="w-full rounded-xl border border-white/10 bg-surface-container-low px-3 py-2 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50" />
      </label>
      <button type="button" className={BTN_PRIMARY} onClick={() => void submit()} disabled={!value.trim() || resolve.isPending}>Сохранить</button>
    </div>
  )
}

function DiscrepancyRow({ d, canManage }: { d: Disc; canManage: boolean }) {
  const resolve = useResolveDiscrepancy()
  const [custom, setCustom] = useState(d.kind === 'invalid')
  const decide = async (body: Parameters<typeof resolve.mutateAsync>[0]['body'], ok: string) => {
    try {
      await resolve.mutateAsync({ id: d.id, body })
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить решение')
    }
  }
  const title = d.kind === 'conflict' ? 'Источники расходятся' : d.kind === 'invalid' ? 'Недопустимое значение' : 'Необычное значение'
  return (
    <li className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <Icon name={d.kind === 'conflict' ? 'compare_arrows' : 'error'} className="text-[18px] text-amber-200 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface">{d.metricLabel} · {d.periodLabel}</p>
          <p className="text-xs text-on-surface-variant">{title}</p>
          <ul className="mt-2 space-y-1">
            {d.candidates.map((c, i) => (
              <li key={`${c.sourceRef}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-on-surface-variant">
                  {SOURCE_RU[c.sourceKind] ?? c.sourceKind}{c.note ? ` «${c.note}»` : ''}: <b className="text-on-surface font-mono">{fmtValue(c.value, c.unit)}</b>
                  {i === 0 && d.kind === 'conflict' && <span className="ml-2 text-[10px] font-mono text-primary/80">сейчас в расчёте</span>}
                </span>
                {canManage && d.kind !== 'invalid' && (
                  <button type="button" className={cn(BTN_GHOST, 'py-1 min-h-[30px]')} disabled={resolve.isPending}
                    onClick={() => void decide({ choice: 'candidate', index: i }, i === 0 ? 'Оставили значение — расхождение закрыто' : 'Взяли значение — Точка А пересчитается')}>
                    {c.sourceKind === 'survey' ? 'Верно из анкеты' : c.sourceKind === 'document' ? 'Взять из документа' : 'Это верно'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={cn(BTN_GHOST, 'py-1 min-h-[30px]')} onClick={() => setCustom((v) => !v)} aria-expanded={custom}>Ввести другое</button>
              <button type="button" className={cn(BTN_GHOST, 'py-1 min-h-[30px]')} disabled={resolve.isPending}
                onClick={() => void decide({ choice: 'ignore' }, 'Скрыто')}>Не важно</button>
            </div>
          )}
          {canManage && custom && <CustomValue d={d} onDone={() => setCustom(false)} />}
        </div>
      </div>
    </li>
  )
}

export function AttentionPanel({ state }: { state: PointAPageState }) {
  const checklist = state.snapshot?.uploadChecklist.slice(0, 3) ?? []
  if (!state.discrepancies.length && !checklist.length) return null
  return (
    <section className={CARD} aria-labelledby="pa-attention">
      <SectionTitle icon="priority_high"><span id="pa-attention">Требует внимания</span></SectionTitle>
      {state.discrepancies.length > 0 && (
        <>
          <p className="text-xs text-on-surface-variant mb-2">
            Найдено расхождений в данных: {state.discrepancies.length}. Пока они не решены, в расчёте используется значение из анкеты, а достоверность снижена.
          </p>
          <ul className="space-y-2 mb-4">
            {state.discrepancies.slice(0, 6).map((d) => <DiscrepancyRow key={d.id} d={d} canManage={state.canManage} />)}
          </ul>
        </>
      )}
      {checklist.length > 0 && (
        <div>
          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">Что добавить, чтобы Точка А стала точнее</p>
          <ul className="space-y-1.5">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-on-surface"><span className="text-on-surface-variant">{c.title}:</span> {c.what}</span>
                <span className="font-mono text-[11px] text-primary whitespace-nowrap">+{c.gain}%</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/client/onboarding" className={BTN_GHOST}><Icon name="edit_note" className="text-[16px]" />Дополнить анкету</Link>
            <Link href="/client/onboarding/documents" className={BTN_GHOST}><Icon name="upload_file" className="text-[16px]" />Загрузить документы</Link>
          </div>
        </div>
      )}
    </section>
  )
}
