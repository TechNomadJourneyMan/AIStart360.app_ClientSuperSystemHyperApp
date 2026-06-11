'use client'

/**
 * MarketAnalysisChecklist — ЭТАП 02 «Анализ рынка».
 *
 * 50-вопросный чек-лист оценки рынка (6 блоков A–F). Каждый ответ — сигнал:
 * можно ли вывести продукт на $2M. Источник данных — live API
 * `/api/v1/market-analysis` (строится параллельно). Все состояния честные:
 * загрузка → скелетон, ошибка → понятная карточка с retry, пусто → объяснение.
 *
 * Правило Точки А: ответы ИИ (status 'draft') требуют подтверждения человеком;
 * ИИ не подтверждает сам себя.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast, Toaster } from 'sonner'

// ── API contract types ──────────────────────────────────────────────────────

type AnswerSource = 'ai' | 'user' | 'expert'
type AnswerStatus = 'draft' | 'confirmed' | 'disputed'

interface QuestionAnswer {
  text: string
  source: AnswerSource
  status: AnswerStatus
  confidence?: number | null
  updated_at: string
}

interface Question {
  key: string
  idx: number
  text: string
  answer: QuestionAnswer | null
}

interface Block {
  id: string
  code: string
  title: string
  questions: Question[]
}

interface Progress {
  answered: number
  confirmed: number
  total: number
}

interface MarketAnalysisData {
  blocks: Block[]
  progress: Progress
  snapshot: object | null
}

type GetResponse =
  | { ok: true; data: MarketAnalysisData }
  | { ok: false; error: string }

type GenerateResponse =
  | { ok: true; data: { generated: number; skipped_confirmed: number; model: string } }
  | { ok: false; error: string }

type PatchAction = 'confirm' | 'dispute' | 'edit'

// ── Per-block presentation metadata (titles/descriptions come from the spec) ──

const BLOCK_META: Record<
  string,
  { color: string; tint: string; border: string; description: string }
> = {
  A: {
    color: '#6effc0',
    tint: 'rgba(110,255,192,0.10)',
    border: 'rgba(110,255,192,0.30)',
    description:
      'TAM (общий объём рынка), SAM (доступный сегмент), SOM (достижимый рынок за 12–18 мес). Хватит ли ёмкости, чтобы выйти на $2M.',
  },
  B: {
    color: '#7dd3fc',
    tint: 'rgba(125,211,252,0.10)',
    border: 'rgba(125,211,252,0.30)',
    description:
      'CAGR (среднегодовой темп роста), драйверы спроса, сезонность. Растёт ли рынок по-настоящему.',
  },
  C: {
    color: '#c4b5fd',
    tint: 'rgba(196,181,253,0.10)',
    border: 'rgba(196,181,253,0.30)',
    description:
      'Сильные тренды, глобальные сдвиги, новые форматы потребления. Можно ли войти «в волну».',
  },
  D: {
    color: '#fcd34d',
    tint: 'rgba(252,211,77,0.10)',
    border: 'rgba(252,211,77,0.30)',
    description:
      'Регуляторика, лицензии, капитал на вход, CAC (стоимость привлечения клиента), R&D. Что мешает войти.',
  },
  E: {
    color: '#fca5a5',
    tint: 'rgba(252,165,165,0.10)',
    border: 'rgba(252,165,165,0.30)',
    description:
      'Топ-5 конкурентов, их сильные стороны и слепые зоны. Где их слабости — там наша точка входа.',
  },
  F: {
    color: '#f0abfc',
    tint: 'rgba(240,171,252,0.10)',
    border: 'rgba(240,171,252,0.30)',
    description:
      'Микросегменты ×10: где боль + деньги, кого проще охватить первыми 100 клиентами.',
  },
}

const SOURCE_LABEL: Record<AnswerSource, string> = {
  ai: 'AI',
  user: 'вручную',
  expert: 'эксперт',
}

function blockMeta(id: string) {
  return (
    BLOCK_META[id] ?? {
      color: '#6effc0',
      tint: 'rgba(110,255,192,0.10)',
      border: 'rgba(110,255,192,0.30)',
      description: '',
    }
  )
}

function countAnswered(block: Block): number {
  return block.questions.filter((q) => q.answer != null).length
}

// ── Component ────────────────────────────────────────────────────────────────

export function MarketAnalysisChecklist() {
  const [data, setData] = useState<MarketAnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState(false)
  // null = key not configured banner; 'error' = generic failure banner
  const [generateState, setGenerateState] = useState<'idle' | 'not_configured' | 'error'>('idle')
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({ A: true })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/v1/market-analysis', { cache: 'no-store' })
      const json = (await res.json()) as GetResponse
      if (!res.ok || !json.ok) {
        setLoadError(true)
        setData(null)
        return
      }
      setData(json.data)
    } catch {
      setLoadError(true)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // ── Generate AI draft ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenerateState('idle')
    try {
      const res = await fetch('/api/v1/market-analysis/generate', { method: 'POST' })
      const json = (await res.json()) as GenerateResponse
      if (!res.ok || !json.ok) {
        const err = json.ok === false ? json.error : 'error'
        setGenerateState(err === 'ai_not_configured' ? 'not_configured' : 'error')
        return
      }
      toast.success(
        `AI-черновик готов: ${json.data.generated} ответов${
          json.data.skipped_confirmed ? `, ${json.data.skipped_confirmed} подтверждённых пропущено` : ''
        }`,
      )
      await fetchData()
    } catch {
      setGenerateState('error')
    } finally {
      setGenerating(false)
    }
  }, [fetchData])

  // ── PATCH a single question with optimistic update + rollback ───────────────
  const patchQuestion = useCallback(
    async (questionKey: string, action: PatchAction, text?: string): Promise<boolean> => {
      const snapshot = data
      if (!snapshot) return false

      // Optimistic next-state
      const optimistic: MarketAnalysisData = applyLocalChange(snapshot, questionKey, action, text)
      setData(optimistic)

      try {
        const res = await fetch('/api/v1/market-analysis', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_key: questionKey, action, ...(text != null ? { text } : {}) }),
        })
        const json = (await res.json()) as { ok: boolean; error?: string }
        if (!res.ok || !json.ok) {
          setData(snapshot) // rollback
          toast.error('Не удалось сохранить изменение')
          return false
        }
        // Re-sync authoritative state (status/confidence/updated_at от сервера).
        await fetchData()
        return true
      } catch {
        setData(snapshot) // rollback
        toast.error('Сеть недоступна — изменение отменено')
        return false
      }
    },
    [data, fetchData],
  )

  const progress = data?.progress ?? { answered: 0, confirmed: 0, total: 50 }
  const hasAnyAnswer = (data?.blocks ?? []).some((b) => countAnswered(b) > 0)

  const blockChips = useMemo(
    () =>
      (data?.blocks ?? []).map((b) => ({
        id: b.id,
        answered: countAnswered(b),
        total: b.questions.length,
      })),
    [data],
  )

  return (
    <div className="relative">
      <Toaster theme="dark" position="bottom-right" richColors />

      {/* Decorative glow */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/5 rounded-full blur-[120px]"
        aria-hidden="true"
      />

      <div className="relative z-10 space-y-6">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header>
          <p className="text-[11px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
            Анализ рынка · Этап 02
          </p>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-on-surface tracking-tight">
            Чек-лист оценки рынка
          </h1>
          <p className="text-sm text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
            50 вопросов · 6 блоков. Каждый ответ — сигнал: можно ли вывести продукт на $2M.
          </p>
        </header>

        {/* ── Progress + Generate CTA ─────────────────────────────────────── */}
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 sm:p-6 shadow-card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-mono font-black text-primary tabular-nums leading-none">
                  {progress.confirmed}
                </span>
                <span className="text-sm text-on-surface-variant">
                  подтверждено из {progress.total}
                </span>
                <span className="text-xs font-mono text-on-surface-variant/70">
                  · отвечено {progress.answered}
                </span>
              </div>

              {/* Progress bar: confirmed (teal) over answered (dimmer) */}
              <div className="mt-3 h-2 w-full rounded-full bg-surface-container overflow-hidden relative">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/25 rounded-full transition-all duration-500"
                  style={{ width: `${pct(progress.answered, progress.total)}%` }}
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${pct(progress.confirmed, progress.total)}%` }}
                  aria-hidden="true"
                />
              </div>

              {/* Per-block mini chips */}
              <div className="mt-4 flex flex-wrap gap-2">
                {blockChips.map((c) => {
                  const m = blockMeta(c.id)
                  const done = c.total > 0 && c.answered === c.total
                  return (
                    <div
                      key={c.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono tabular-nums"
                      style={{
                        borderColor: done ? m.border : 'rgba(255,255,255,0.06)',
                        background: done ? m.tint : 'transparent',
                      }}
                      title={`Блок ${c.id}: ${c.answered}/${c.total} отвечено`}
                    >
                      <span className="font-bold" style={{ color: m.color }}>
                        {c.id}
                      </span>
                      <span className="text-on-surface-variant">
                        {c.answered}/{c.total}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Generate CTA */}
            <div className="flex flex-col items-stretch gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating || loading}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white font-bold text-sm hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-orange-400/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                  boxShadow: '0 0 20px -8px rgba(232,122,53,0.55)',
                }}
              >
                <span
                  className={`material-symbols-outlined text-base ${generating ? 'animate-spin' : ''}`}
                >
                  {generating ? 'progress_activity' : 'auto_awesome'}
                </span>
                {generating ? 'Генерация…' : 'Сгенерировать AI-черновик'}
              </button>
              <p className="text-[10px] font-mono text-on-surface-variant/60 text-center max-w-[220px]">
                ИИ заполнит черновики · подтверждаете вы
              </p>
            </div>
          </div>

          {/* Generate shimmer */}
          {generating && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3">
              <span className="material-symbols-outlined text-primary animate-pulse">radar</span>
              <span className="text-sm text-on-surface-variant">
                AI анализирует рынок по открытым данным…
              </span>
              <span className="ml-auto flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          )}

          {/* Honest banners on generate failure */}
          {!generating && generateState === 'not_configured' && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.05] px-4 py-3">
              <span className="material-symbols-outlined text-amber-400 text-lg">key_off</span>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                AI-генерация недоступна: не настроен ключ OpenRouter. Ответы можно заполнить вручную.
              </p>
            </div>
          )}
          {!generating && generateState === 'error' && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error/[0.06] px-4 py-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-error text-lg">error</span>
                <p className="text-sm text-on-surface-variant">Не удалось сгенерировать черновик</p>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-error hover:text-error/80 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                Повторить
              </button>
            </div>
          )}
        </section>

        {/* ── Body: loading / error / empty / blocks ──────────────────────── */}
        {loading ? (
          <ChecklistSkeleton />
        ) : loadError ? (
          <ErrorCard onRetry={() => void fetchData()} />
        ) : (
          <>
            {!hasAnyAnswer && <EmptyExplainer />}
            <div className="space-y-3">
              {(data?.blocks ?? []).map((block) => (
                <BlockSection
                  key={block.id}
                  block={block}
                  open={!!openBlocks[block.id]}
                  onToggle={() =>
                    setOpenBlocks((prev) => ({ ...prev, [block.id]: !prev[block.id] }))
                  }
                  onPatch={patchQuestion}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Block section (collapsible) ──────────────────────────────────────────────

function BlockSection({
  block,
  open,
  onToggle,
  onPatch,
}: {
  block: Block
  open: boolean
  onToggle: () => void
  onPatch: (key: string, action: PatchAction, text?: string) => Promise<boolean>
}) {
  const m = blockMeta(block.id)
  const answered = countAnswered(block)
  const total = block.questions.length

  return (
    <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] shadow-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-surface-container/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {/* Colored letter badge */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center border flex-shrink-0 font-mono font-black text-lg"
          style={{ background: m.tint, borderColor: m.border, color: m.color }}
        >
          {block.id}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-headline text-lg font-extrabold text-on-surface truncate">
              {block.title}
            </h2>
            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-2 py-0.5 rounded-md border border-white/[0.06] bg-surface-container">
              {total} вопросов
            </span>
          </div>
          {m.description && (
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed line-clamp-2">
              {m.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-mono tabular-nums text-on-surface-variant whitespace-nowrap">
            <span style={{ color: m.color }} className="font-bold">
              {answered}
            </span>
            /{total}
          </span>
          <span
            className={`material-symbols-outlined text-xl text-on-surface-variant transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.04] p-4 sm:p-5 space-y-3">
          {block.questions.map((q) => (
            <QuestionRow key={q.key} question={q} accent={m.color} onPatch={onPatch} />
          ))}
        </div>
      )}
    </section>
  )
}

// ── Question row ─────────────────────────────────────────────────────────────

function QuestionRow({
  question,
  accent,
  onPatch,
}: {
  question: Question
  accent: string
  onPatch: (key: string, action: PatchAction, text?: string) => Promise<boolean>
}) {
  const { answer } = question
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(answer?.text ?? '')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setDraft(answer?.text ?? '')
    setEditing(true)
  }

  const save = async () => {
    const text = draft.trim()
    if (!text) return
    setSaving(true)
    const ok = await onPatch(question.key, 'edit', text)
    setSaving(false)
    if (ok) setEditing(false)
  }

  const status = answer?.status

  // Card framing differs by status.
  const cardClass =
    status === 'draft'
      ? 'border border-amber-400/30 bg-amber-400/[0.05]'
      : status === 'confirmed'
        ? 'border border-white/[0.04] bg-surface-container border-l-2 border-l-primary'
        : status === 'disputed'
          ? 'border border-error/25 bg-error/[0.04]'
          : 'border border-white/[0.04] bg-surface-container'

  return (
    <div className={`rounded-xl p-4 transition-colors ${cardClass}`}>
      {/* Question text */}
      <div className="flex items-start gap-3">
        <span
          className="text-[11px] font-mono font-bold tabular-nums mt-0.5 flex-shrink-0"
          style={{ color: accent }}
        >
          {question.key}
        </span>
        <p className="text-sm text-on-surface leading-relaxed flex-1">{question.text}</p>
      </div>

      {/* Answer area */}
      <div className="mt-3 pl-7">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ваш ответ…"
              className="w-full rounded-lg bg-surface-container-high border border-white/[0.08] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">{saving ? 'progress_activity' : 'save'}</span>
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-on-surface-variant border border-white/[0.06] text-xs font-medium hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : answer == null ? (
          // ── No answer ────────────────────────────────────────────────────
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-on-surface-variant/60 italic">Нет ответа</span>
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs font-medium hover:text-primary hover:border-primary/30 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">edit_note</span>
              Ответить
            </button>
          </div>
        ) : (
          // ── Has answer ───────────────────────────────────────────────────
          <div className="space-y-2.5">
            <AnswerChip answer={answer} />
            <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
              {answer.text}
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              {status === 'draft' && (
                <button
                  type="button"
                  onClick={() => void onPatch(question.key, 'confirm')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  Подтвердить
                </button>
              )}

              <button
                type="button"
                onClick={startEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs font-medium hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                Редактировать
              </button>

              {status !== 'disputed' && (
                <button
                  type="button"
                  onClick={() => void onPatch(question.key, 'dispute')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant/70 text-xs font-medium hover:text-error transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">flag</span>
                  Оспорить
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Answer status chip ───────────────────────────────────────────────────────

function AnswerChip({ answer }: { answer: QuestionAnswer }) {
  const { status, source, confidence } = answer

  if (status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-400/40 bg-amber-400/[0.08] text-[10px] font-mono uppercase tracking-wide text-amber-300">
        <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
        AI · предположение
        {confidence != null && (
          <span className="text-amber-200/80 tabular-nums">· {formatConfidence(confidence)}%</span>
        )}
      </span>
    )
  }

  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-primary/40 bg-primary/[0.08] text-[10px] font-mono uppercase tracking-wide text-primary">
        <span className="material-symbols-outlined text-[13px]">verified</span>
        Подтверждено · {SOURCE_LABEL[source]}
      </span>
    )
  }

  // disputed
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-error/40 bg-error/[0.08] text-[10px] font-mono uppercase tracking-wide text-error">
      <span className="material-symbols-outlined text-[13px]">flag</span>
      Оспорено · {SOURCE_LABEL[source]}
    </span>
  )
}

// ── Loading / error / empty states ───────────────────────────────────────────

function ChecklistSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 shadow-card"
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-surface-container animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-surface-container animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-surface-container animate-pulse" />
            </div>
          </div>
          {i === 0 && (
            <div className="mt-4 space-y-2">
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-16 rounded-xl bg-surface-container animate-pulse" />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-error/20 p-8 text-center shadow-card">
      <span className="material-symbols-outlined text-3xl text-error/80">cloud_off</span>
      <p className="text-sm font-bold text-on-surface mt-3">Не удалось загрузить анализ рынка</p>
      <p className="text-xs text-on-surface-variant mt-1.5 max-w-md mx-auto leading-relaxed">
        Проверьте подключение и попробуйте снова. Если проблема повторяется — данные ещё не готовы на сервере.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl border border-white/[0.08] text-on-surface text-sm font-medium hover:border-primary/30 hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">refresh</span>
        Повторить
      </button>
    </div>
  )
}

function EmptyExplainer() {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 text-center shadow-card">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/50">checklist</span>
      <p className="text-sm font-bold text-on-surface mt-3">Пока нет ответов</p>
      <p className="text-xs text-on-surface-variant mt-1.5 max-w-lg mx-auto leading-relaxed">
        Ответы появятся после AI-генерации или вручную. Заполните анкету (отрасль, конкуренты) — это
        повысит точность.
      </p>
    </div>
  )
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function pct(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)))
}

/** Confidence may arrive as 0–1 or 0–100; normalise to a whole-percent number. */
function formatConfidence(confidence: number): number {
  const normalised = confidence <= 1 ? confidence * 100 : confidence
  return Math.round(Math.min(100, Math.max(0, normalised)))
}

/**
 * Produce an optimistic copy of the data with the given question mutated.
 * Server response re-syncs authoritative fields afterwards.
 */
function applyLocalChange(
  data: MarketAnalysisData,
  questionKey: string,
  action: PatchAction,
  text?: string,
): MarketAnalysisData {
  const blocks = data.blocks.map((block) => ({
    ...block,
    questions: block.questions.map((q) => {
      if (q.key !== questionKey) return q
      const now = new Date().toISOString()
      if (action === 'confirm') {
        return q.answer
          ? { ...q, answer: { ...q.answer, status: 'confirmed' as AnswerStatus, updated_at: now } }
          : q
      }
      if (action === 'dispute') {
        return q.answer
          ? { ...q, answer: { ...q.answer, status: 'disputed' as AnswerStatus, updated_at: now } }
          : q
      }
      // edit
      const newText = text ?? q.answer?.text ?? ''
      return {
        ...q,
        answer: {
          text: newText,
          source: 'user' as AnswerSource,
          status: 'confirmed' as AnswerStatus,
          confidence: null,
          updated_at: now,
        },
      }
    }),
  }))

  // Recompute progress optimistically.
  const all = blocks.flatMap((b) => b.questions)
  const answered = all.filter((q) => q.answer != null).length
  const confirmed = all.filter((q) => q.answer?.status === 'confirmed').length

  return { ...data, blocks, progress: { ...data.progress, answered, confirmed } }
}
