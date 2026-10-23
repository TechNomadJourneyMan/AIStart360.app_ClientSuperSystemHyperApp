'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import AnswerEditorModal, { type AnswerEditorTarget } from '@/components/onboarding/AnswerEditorModal'
import { TermHint } from '@/components/onboarding/shared/TermHint'
import {
  ANSWER_FILTERS, ANSWER_FILTER_LABELS, answersSummary, buildAnswerItems, filterAnswerItems, formHref, groupAnswerItems,
  type AnswerFilter, type AnswerItem, type AnswersGrouping,
} from '@/lib/survey/answers-view'
import { formatAttributionDate, formatAuthorSummary, type AnswerAttribution, type AttributionViewer } from '@/lib/survey/attribution-label'
import { AnswerInlineEditor, type SaveAnswer } from './AnswerInlineEditor'

export interface SurveyAnswersViewProps {
  answers: Readonly<Record<string, unknown>>
  attribution: Readonly<Record<string, AnswerAttribution | undefined>>
  /** Client: `{ viewerIsOwner: true }`; staff: `{ viewerId, ownerName }`. */
  viewer: AttributionViewer
  mode: 'client' | 'staff'
  canEdit: boolean
  onSave?: SaveAnswer
  /** Staff: the reason field — required (expert) or optional (GIGA). */
  reason?: 'required' | 'optional' | 'none'
  initialFilters?: AnswerFilter[]
  initialGrouping?: AnswersGrouping
  initialSearch?: string
  /** Attachments of the Markdown editor (client only). */
  companyId?: string | null
  /** «Скачать PDF». */
  pdfHref?: string | null
  /** Extra actions in the header (mode switch, «К анкете» …). */
  actions?: ReactNode
  /** Staff: a per-question history button. */
  onHistory?: (key: string) => void
  /** Staff: raw edit of tables / files (GIGA JSON editor). */
  onEditRaw?: (key: string) => void
  /** A link that opens a file answer (access-checked route), or null. */
  fileLink?: (key: string, value: unknown) => string | null
}

const CHIP = 'px-3 py-2 min-h-[36px] rounded-lg text-xs font-medium border transition-colors whitespace-nowrap'
const chipTone = (on: boolean) => (on ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/[0.02] border-white/[0.08] text-on-surface-variant hover:border-white/20')

/**
 * All questionnaire answers on one page (spec 2026-10-23 §6.2–§6.5): the same
 * component for the client («Мои ответы»), GIGA and the expert cabinet. Groups
 * by step or by mode-2 block, filters, search, the author and path of every
 * answer, «кто заполнял», editing in place / in the Markdown editor / in the
 * form, print (one column, no buttons). Logic: lib/survey/answers-view.ts.
 */
export function SurveyAnswersView(props: SurveyAnswersViewProps) {
  const { answers, attribution, viewer, mode, canEdit, onSave } = props
  const [filters, setFilters] = useState<AnswerFilter[]>(props.initialFilters ?? [])
  const [grouping, setGrouping] = useState<AnswersGrouping>(props.initialGrouping ?? 'steps')
  const [search, setSearch] = useState(props.initialSearch ?? '')
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmStaff, setConfirmStaff] = useState<string | null>(null)
  const [modal, setModal] = useState<AnswerEditorTarget | null>(null)

  const items = useMemo(() => buildAnswerItems(answers, attribution, viewer), [answers, attribution, viewer])
  const summary = useMemo(() => answersSummary(items, answers), [items, answers])
  const visible = useMemo(() => filterAnswerItems(items, filters, search), [items, filters, search])
  const groups = useMemo(() => groupAnswerItems(visible, grouping), [visible, grouping])
  const editable = canEdit && !!onSave
  const narrowed = filters.length > 0 || search.trim().length > 0

  const toggleFilter = (f: AnswerFilter) => setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))

  const startEdit = (item: AnswerItem) => {
    const a = item.attribution
    // A client changing an answer an expert set: ask once, never forbid (spec §6.3).
    if (mode === 'client' && (a?.updatedByRole === 'expert' || a?.updatedByRole === 'admin') && confirmStaff !== item.question.key) {
      setConfirmStaff(item.question.key)
      return
    }
    setConfirmStaff(null)
    if (item.edit === 'modal') {
      setModal({ key: item.question.key, title: item.question.label, hint: item.question.plain ?? null, value: item.value })
      return
    }
    setEditing(item.question.key)
  }

  const save: SaveAnswer = async (key, value, reason) => {
    if (!onSave) return { ok: false, error: 'Изменение недоступно' }
    const res = await onSave(key, value, reason)
    if (res.ok) setEditing(null)
    return res
  }

  return (
    <div className="survey-answers space-y-5 print:space-y-3 print:text-black">
      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <section aria-label="Сводка" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 sm:p-5 print:border-black/20 print:bg-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface print:text-black">
              Отвечено {summary.answered} из {summary.total} · глубина {summary.depth} %
            </p>
            <p className="mt-1 text-xs text-on-surface-variant print:text-black/70">
              Минимум для Точки А: <b className="text-on-surface print:text-black">{summary.minimum.answered} из {summary.minimum.total}</b>
              {summary.unknown > 0 && <> · «Не знаю»: {summary.unknown}</>}
              {summary.approx > 0 && <> · примерно: {summary.approx}</>}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant print:text-black/70" data-testid="authors-summary">
              Кто заполнял: {formatAuthorSummary(summary.authors, viewer)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {props.actions}
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/10 px-3 text-xs text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">print</span>Печать
            </button>
            {props.pdfHref && (
              <a href={props.pdfHref} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/10 px-3 text-xs text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">picture_as_pdf</span>Скачать PDF
              </a>
            )}
          </div>
        </div>
        <p className="mt-2 hidden text-[10px] text-black/60 print:block">Выгружено {formatAttributionDate(new Date().toISOString())}</p>
      </section>

      {/* ── Search, filters, grouping ───────────────────────────────────── */}
      <div className="space-y-3 print:hidden">
        <div role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="survey-answers-search" className="sr-only">Поиск по вопросам и ответам</label>
          <input
            id="survey-answers-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по вопросам и ответам"
            className="w-full flex-1 rounded-xl border border-white/[0.08] bg-surface-container px-4 py-2.5 text-base text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none"
          />
          <p aria-live="polite" className="text-xs text-on-surface-variant sm:w-32 sm:text-right">
            {narrowed ? `Найдено: ${visible.length}` : `Всего: ${items.length}`}
          </p>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Фильтры">
          <button type="button" aria-pressed={filters.length === 0} className={`${CHIP} ${chipTone(filters.length === 0)}`} onClick={() => setFilters([])}>Все</button>
          {ANSWER_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filters.includes(f)} className={`${CHIP} ${chipTone(filters.includes(f))}`} onClick={() => toggleFilter(f)}>
              {ANSWER_FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-on-surface-variant" role="group" aria-label="Группировка">
          <span>Показать:</span>
          <button type="button" aria-pressed={grouping === 'steps'} className={`${CHIP} ${chipTone(grouping === 'steps')}`} onClick={() => setGrouping('steps')}>по разделам анкеты</button>
          <button type="button" aria-pressed={grouping === 'blocks'} className={`${CHIP} ${chipTone(grouping === 'blocks')}`} onClick={() => setGrouping('blocks')}>по блокам быстрого старта</button>
        </div>
        {groups.length > 1 && (
          <div className="lg:hidden">
            <label htmlFor="survey-answers-toc" className="sr-only">Перейти к разделу</label>
            <select id="survey-answers-toc" defaultValue="" onChange={(e) => e.target.value && document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' })}
              className="w-full rounded-xl border border-white/[0.08] bg-surface-container px-4 py-2.5 text-base text-on-surface">
              <option value="">Перейти к разделу…</option>
              {groups.map((g) => <option key={g.id} value={`answers-${g.id}`}>{g.title}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── Groups ──────────────────────────────────────────────────────── */}
      {items.every((i) => !i.filled) && !narrowed && (
        <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-on-surface-variant">
          {mode === 'client' ? 'Ответов пока нет. Начните с анкеты — всё сохраняется автоматически.' : 'Клиент ещё не отвечал на вопросы анкеты.'}
        </p>
      )}
      {groups.length === 0 && narrowed && (
        <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-on-surface-variant">Ничего не найдено. Измените фильтр или запрос.</p>
      )}
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6 print:block">
        {groups.length > 1 && (
          <nav aria-label="Разделы анкеты" className="hidden lg:block print:hidden">
            <ul className="sticky top-4 space-y-1 text-xs">
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`#answers-${g.id}`} className="flex justify-between gap-2 rounded-lg px-2 py-1.5 text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface">
                    <span className="truncate">{g.title}</span>
                    <span className="tabular-nums text-on-surface-variant/60">{g.answered}/{g.total}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className={`space-y-5 ${groups.length > 1 ? '' : 'lg:col-span-2'}`}>
          {groups.map((g) => (
            <section key={g.id} id={`answers-${g.id}`} aria-labelledby={`answers-${g.id}-title`} className="scroll-mt-4 rounded-2xl border border-white/[0.06] bg-surface-container-low print:break-inside-auto print:border-black/20 print:bg-transparent">
              <header className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 py-3 print:border-black/20">
                <h2 id={`answers-${g.id}-title`} className="text-sm font-bold text-on-surface print:text-black">{g.title}</h2>
                <span className="text-[11px] text-on-surface-variant print:text-black/60">заполнено {g.answered} из {g.total}</span>
              </header>
              <dl className="divide-y divide-white/[0.04] print:divide-black/10">
                {g.items.map((item) => (
                  <AnswerRow
                    key={item.question.key}
                    item={item}
                    mode={mode}
                    editable={editable}
                    editing={editing === item.question.key}
                    confirming={confirmStaff === item.question.key}
                    reason={props.reason ?? 'none'}
                    onEdit={() => startEdit(item)}
                    onCancel={() => { setEditing(null); setConfirmStaff(null) }}
                    onSave={save}
                    onHistory={props.onHistory}
                    onEditRaw={editable ? props.onEditRaw : undefined}
                    fileLink={props.fileLink}
                  />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>

      <AnswerEditorModal
        target={modal}
        companyId={props.companyId ?? null}
        attachments={mode === 'client' && !!props.companyId}
        onClose={() => setModal(null)}
        onSave={async (key, value) => {
          if (props.reason === 'required') return { ok: false, error: 'Длинный ответ эксперт меняет через поле ниже с причиной' }
          const res = await save(key, value)
          if (res.ok) setModal(null)
          return res
        }}
      />
    </div>
  )
}

function AnswerRow({ item, mode, editable, editing, confirming, reason, onEdit, onCancel, onSave, onHistory, onEditRaw, fileLink }: {
  item: AnswerItem
  mode: 'client' | 'staff'
  editable: boolean
  editing: boolean
  confirming: boolean
  reason: 'required' | 'optional' | 'none'
  onEdit: () => void
  onCancel: () => void
  onSave: SaveAnswer
  onHistory?: (key: string) => void
  onEditRaw?: (key: string) => void
  fileLink?: (key: string, value: unknown) => string | null
}) {
  const q = item.question
  const link = item.filled && q.type === 'file' && fileLink ? fileLink(q.key, item.value) : null
  // Experts write a reason for every change: long text too goes through the inline field.
  const kind = reason === 'required' && item.edit === 'modal' ? 'inline' : item.edit
  const canEditHere = editable && (kind === 'inline' || kind === 'modal')
  const staffName = item.attribution?.updatedByName
  return (
    <div id={`answer-${q.key}`} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:gap-4 print:grid-cols-1 print:py-2">
      <dt className="text-xs text-on-surface-variant print:text-black/70">
        {q.label}
        {q.term && <span className="print:hidden"><TermHint term={q.term} /></span>}
        {q.auto && <span className="ml-1 text-[10px] text-on-surface-variant/60">(считается автоматически)</span>}
      </dt>
      <dd className="min-w-0">
        <p className={`whitespace-pre-line break-words text-sm ${item.filled ? 'text-on-surface print:text-black' : 'text-on-surface-variant/50 print:text-black/40'}`}>
          {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{item.display}</a> : item.display}
        </p>
        {item.authorLine && <p className="mt-0.5 text-[11px] text-on-surface-variant/70 print:text-black/50">{item.authorLine}</p>}
        {confirming && (
          <div role="alert" className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-2 text-xs text-on-surface print:hidden">
            Этот ответ изменил эксперт{staffName ? ` ${staffName}` : ''}{item.attribution?.updatedAt ? ` ${formatAttributionDate(item.attribution.updatedAt)}` : ''}. Изменить всё равно?
            <span className="mt-2 flex gap-2">
              <button type="button" onClick={onEdit} className="min-h-[36px] rounded-lg bg-primary/20 px-3 text-primary">Изменить</button>
              <button type="button" onClick={onCancel} className="min-h-[36px] rounded-lg border border-white/10 px-3 text-on-surface-variant">Оставить</button>
            </span>
          </div>
        )}
        {editing && kind === 'inline' && (
          <AnswerInlineEditor
            question={q}
            value={item.value}
            onSave={onSave}
            onCancel={onCancel}
            requireReason={reason === 'required'}
            reasonOptional={reason === 'optional'}
          />
        )}
      </dd>
      <div className="flex flex-wrap items-start gap-1 print:hidden">
        {canEditHere && !editing && (
          <button type="button" onClick={onEdit} aria-label={`${item.filled ? 'Изменить' : 'Ответить'}: ${q.label}`}
            className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-primary hover:bg-primary/10">
            {item.filled ? 'Изменить' : 'Ответить'}
          </button>
        )}
        {mode === 'client' && kind === 'form' && (
          <Link href={formHref(q)} className="min-h-[36px] rounded-lg px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10">
            Открыть в анкете
          </Link>
        )}
        {mode === 'staff' && kind === 'form' && onEditRaw && (
          <button type="button" onClick={() => onEditRaw(q.key)} aria-label={`Изменить: ${q.label}`}
            className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-primary hover:bg-primary/10">
            Изменить
          </button>
        )}
        {onHistory && (
          <button type="button" onClick={() => onHistory(q.key)} aria-label={`История: ${q.label}`} className="min-h-[36px] rounded-lg px-2 text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">history</span>
          </button>
        )}
      </div>
    </div>
  )
}
