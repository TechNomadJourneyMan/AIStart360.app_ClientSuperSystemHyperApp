'use client'

/**
 * MarketAnalysisChecklist — ЭТАП 02 «Анализ рынка».
 *
 * 50-вопросный чек-лист оценки рынка (6 блоков A–F). Каждый ответ — сигнал:
 * можно ли вывести продукт на $2M. Источник данных — live API
 * `/api/v1/market-analysis` (Supabase, таблица market_analysis_answers).
 * Все состояния честные: загрузка → скелетон, ошибка → карточка с retry,
 * пусто → объяснение с переходом туда, где данные заполняют.
 *
 * Правило Точки А: ответы ИИ (status 'draft') требуют подтверждения человеком;
 * ИИ не подтверждает сам себя.
 *
 * Отметка ответа (подтвердить / оспорить / изменить) идёт оптимистично, а
 * ресинхронизация с сервером — фоновая: экран больше не схлопывается в скелетон
 * после каждого клика (из-за этого раздел и выглядел мёртвым).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import type { ConfirmedAnswer } from './MarketDataPanel'

// recharts lives inside MarketDataPanel — load it lazily; the panel only renders
// when a block is expanded, so recharts loads on demand.
const MarketDataPanel = dynamic(() => import('./MarketDataPanel').then((m) => m.MarketDataPanel), {
  ssr: false,
})

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
  /** JSON из market_snapshots — разбираем защитно, см. readSnapshot(). */
  snapshot: unknown
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

// Source chip styling: «Эксперт» (teal), «Владелец» (grey), «AI» (amber).
const SOURCE_CHIP: Record<AnswerSource, { label: string; color: string; bg: string; border: string; icon: string }> = {
  expert: {
    label: 'Эксперт',
    color: '#6effc0',
    bg: 'rgba(110,255,192,0.10)',
    border: 'rgba(110,255,192,0.35)',
    icon: 'workspace_premium',
  },
  user: {
    label: 'Владелец',
    color: 'rgba(255,255,255,0.65)',
    bg: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.12)',
    icon: 'person',
  },
  ai: {
    label: 'AI',
    color: '#fcd34d',
    bg: 'rgba(252,211,77,0.10)',
    border: 'rgba(252,211,77,0.35)',
    icon: 'auto_awesome',
  },
}

// Filter modes over the question rows.
type FilterMode = 'all' | 'confirmed' | 'ai_draft' | 'expert'

const FILTERS: Array<{ id: FilterMode; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'confirmed', label: 'Подтверждённые' },
  { id: 'ai_draft', label: 'Черновики AI' },
  { id: 'expert', label: 'От экспертов' },
]

function matchesFilter(q: Question, mode: FilterMode): boolean {
  if (mode === 'all') return true
  const a = q.answer
  if (!a) return false
  if (mode === 'confirmed') return a.status === 'confirmed'
  if (mode === 'ai_draft') return a.source === 'ai' && a.status === 'draft'
  if (mode === 'expert') return a.source === 'expert'
  return true
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

// ── Generate-failure state ───────────────────────────────────────────────────

type GenerateState =
  | { kind: 'idle' }
  | { kind: 'not_configured' }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'error'; message: string | null }

/** Сервер иногда шлёт готовый русский текст ошибки — не выбрасываем его. */
function humanError(code: string): string | null {
  if (/[А-Яа-яЁё]/.test(code)) return code
  if (code === 'ai_unavailable') return 'Модель ИИ сейчас не отвечает. Попробуйте позже.'
  return null
}

// ── Component ────────────────────────────────────────────────────────────────

export function MarketAnalysisChecklist() {
  const [data, setData] = useState<MarketAnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: 'idle' })
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({ A: true })
  const [filter, setFilter] = useState<FilterMode>('all')
  // Ключ вопроса, к которому только что перешли по клику (инсайт / чип / сводка).
  const [highlight, setHighlight] = useState<string | null>(null)
  // Вопросы, по которым сейчас идёт PATCH — блокируем повторные клики.
  const [pending, setPending] = useState<Record<string, boolean>>({})
  // Текст для скринридера: оптимистичные изменения должны быть озвучены.
  const [announcement, setAnnouncement] = useState('')
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }): Promise<MarketAnalysisData | null> => {
      const silent = opts?.silent === true
      if (silent) setRefreshing(true)
      else {
        setLoading(true)
        setLoadError(false)
      }
      try {
        const res = await fetch('/api/v1/market-analysis', { cache: 'no-store' })
        const json = (await res.json()) as GetResponse
        if (!res.ok || !json.ok) {
          // Фоновая ресинхронизация не имеет права стирать то, что на экране.
          if (silent) {
            toast.error('Изменение сохранено, но обновить список не удалось')
            return null
          }
          setLoadError(true)
          setData(null)
          return null
        }
        setData(json.data)
        return json.data
      } catch {
        if (silent) {
          toast.error('Сеть недоступна — список не обновлён')
          return null
        }
        setLoadError(true)
        setData(null)
        return null
      } finally {
        if (silent) setRefreshing(false)
        else setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    }
  }, [])

  // ── Navigation inside the page (insights / chips / snapshot → question) ─────
  const focusBlock = useCallback((blockId: string) => {
    setOpenBlocks((prev) => ({ ...prev, [blockId]: true }))
    window.setTimeout(() => {
      document.getElementById(`mblock-${blockId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 60)
  }, [])

  const focusQuestion = useCallback((blockId: string, questionKey: string) => {
    // Вопрос мог быть скрыт фильтром — иначе переход «никуда».
    setFilter('all')
    setOpenBlocks((prev) => ({ ...prev, [blockId]: true }))
    setHighlight(questionKey)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlight(null), 2600)
    window.setTimeout(() => {
      const el = document.getElementById(`mq-${questionKey}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
    }, 80)
  }, [])

  const changeFilter = useCallback(
    (mode: FilterMode) => {
      setFilter(mode)
      if (mode === 'all') return
      // Раскрываем блоки, где есть совпадения, иначе фильтр показывает пустоту.
      setOpenBlocks((prev) => {
        const next = { ...prev }
        for (const b of data?.blocks ?? []) {
          if (b.questions.some((q) => matchesFilter(q, mode))) next[b.id] = true
        }
        return next
      })
    },
    [data],
  )

  // ── Generate AI draft ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenerateState({ kind: 'idle' })
    try {
      const res = await fetch('/api/v1/market-analysis/generate', { method: 'POST' })
      const json = (await res.json()) as GenerateResponse
      if (!res.ok || !json.ok) {
        const code = json.ok === false ? json.error : ''
        if (code === 'ai_not_configured') {
          setGenerateState({ kind: 'not_configured' })
        } else if (res.status === 429) {
          setGenerateState({
            kind: 'rate_limited',
            message: humanError(code) ?? 'Слишком много запросов. Попробуйте позже.',
          })
        } else {
          setGenerateState({ kind: 'error', message: humanError(code) })
        }
        return
      }
      toast.success(
        `AI-черновик готов: ${json.data.generated} ответов${
          json.data.skipped_confirmed ? `, ${json.data.skipped_confirmed} подтверждённых пропущено` : ''
        } · модель ${json.data.model}`,
      )
      const fresh = await fetchData({ silent: true })
      // Иначе 50 новых черновиков «сгенерированы», а на экране ничего не изменилось.
      if (fresh) {
        setFilter('ai_draft')
        setOpenBlocks((prev) => {
          const next = { ...prev }
          for (const b of fresh.blocks) {
            if (b.questions.some((q) => matchesFilter(q, 'ai_draft'))) next[b.id] = true
          }
          return next
        })
        setAnnouncement(`Сгенерировано черновиков: ${json.data.generated}. Показаны черновики AI.`)
      }
    } catch {
      setGenerateState({ kind: 'error', message: null })
    } finally {
      setGenerating(false)
    }
  }, [fetchData])

  // ── PATCH a single question with optimistic update + rollback ───────────────
  const patchQuestion = useCallback(
    async (questionKey: string, action: PatchAction, text?: string): Promise<boolean> => {
      const snapshot = data
      if (!snapshot) return false

      setPending((p) => ({ ...p, [questionKey]: true }))
      // Optimistic next-state
      setData(applyLocalChange(snapshot, questionKey, action, text))

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
          setAnnouncement(`Изменение по вопросу ${questionKey} не сохранено`)
          return false
        }
        setAnnouncement(
          action === 'confirm'
            ? `Ответ ${questionKey} подтверждён`
            : action === 'dispute'
              ? `Ответ ${questionKey} отмечен как оспоренный`
              : `Ответ ${questionKey} сохранён`,
        )
        // Фоновая ресинхронизация: сервер владеет status/confidence/updated_at,
        // но экран при этом не схлопывается в скелетон.
        await fetchData({ silent: true })
        return true
      } catch {
        setData(snapshot) // rollback
        toast.error('Сеть недоступна — изменение отменено')
        setAnnouncement(`Изменение по вопросу ${questionKey} отменено: нет сети`)
        return false
      } finally {
        setPending((p) => {
          const next = { ...p }
          delete next[questionKey]
          return next
        })
      }
    },
    [data, fetchData],
  )

  const progress = data?.progress ?? null
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

  // Счётчики на самих чипах фильтра — иначе непонятно, куда жать.
  const filterCounts = useMemo(() => {
    const all = (data?.blocks ?? []).flatMap((b) => b.questions)
    return {
      all: all.length,
      confirmed: all.filter((q) => matchesFilter(q, 'confirmed')).length,
      ai_draft: all.filter((q) => matchesFilter(q, 'ai_draft')).length,
      expert: all.filter((q) => matchesFilter(q, 'expert')).length,
    } as Record<FilterMode, number>
  }, [data])

  // «Инсайты»: подтверждённые ответы экспертов/AI, самые уверенные первыми.
  const insights = useMemo(() => buildInsights(data?.blocks ?? []), [data])
  const snapshot = useMemo(() => readSnapshot(data?.snapshot), [data])

  return (
    <div className="relative">
      {/* Decorative glow */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/5 rounded-full blur-[120px]"
        aria-hidden="true"
      />

      {/* Оптимистичные изменения статуса озвучиваются скринридеру */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

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
              {progress ? (
                <>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => changeFilter('confirmed')}
                      aria-label={`Подтверждено ответов: ${progress.confirmed}. Показать только подтверждённые`}
                      className="text-3xl font-mono font-black text-primary tabular-nums leading-none hover:underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                    >
                      {progress.confirmed}
                    </button>
                    <span className="text-sm text-on-surface-variant">
                      подтверждено из {progress.total}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeFilter('all')}
                      aria-label={`Отвечено вопросов: ${progress.answered}. Показать все вопросы`}
                      className="text-xs font-mono text-on-surface-variant/70 hover:text-on-surface hover:underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                    >
                      · отвечено {progress.answered}
                    </button>
                    {refreshing && (
                      <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-wide">
                        сохраняем…
                      </span>
                    )}
                  </div>

                  {/* Progress bar: confirmed (teal) over answered (dimmer) */}
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.confirmed}
                    aria-valuetext={`${progress.confirmed} из ${progress.total} подтверждено, ${progress.answered} отвечено`}
                    aria-label="Прогресс чек-листа"
                    className="mt-3 h-2 w-full rounded-full bg-surface-container overflow-hidden relative"
                  >
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
                  <p className="mt-1.5 text-[10px] font-mono text-on-surface-variant/50">
                    Тусклая полоса — отвечено, яркая — подтверждено
                  </p>
                </>
              ) : (
                // До ответа сервера не показываем «0 подтверждено из 50» —
                // это число, которого ещё никто не присылал.
                <div className="space-y-3" aria-hidden="true">
                  <div className="h-8 w-48 rounded bg-surface-container animate-pulse" />
                  <div className="h-2 w-full rounded-full bg-surface-container animate-pulse" />
                </div>
              )}

              {/* Per-block mini chips → раскрывают свой блок */}
              {blockChips.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {blockChips.map((c) => {
                    const m = blockMeta(c.id)
                    const done = c.total > 0 && c.answered === c.total
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => focusBlock(c.id)}
                        aria-label={`Блок ${c.id}: ${c.answered} из ${c.total} отвечено. Открыть блок`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono tabular-nums hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        style={{
                          borderColor: done ? m.border : 'rgba(255,255,255,0.06)',
                          background: done ? m.tint : 'transparent',
                        }}
                      >
                        <span className="font-bold" style={{ color: m.color }}>
                          {c.id}
                        </span>
                        <span className="text-on-surface-variant">
                          {c.answered}/{c.total}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
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
                  aria-hidden="true"
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
              <span className="material-symbols-outlined text-primary animate-pulse" aria-hidden="true">
                radar
              </span>
              <span className="text-sm text-on-surface-variant">
                AI анализирует рынок по открытым данным…
              </span>
              <span className="ml-auto flex gap-1" aria-hidden="true">
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
          {!generating && generateState.kind === 'not_configured' && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.05] px-4 py-3">
              <span className="material-symbols-outlined text-amber-400 text-lg" aria-hidden="true">
                key_off
              </span>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                AI-генерация недоступна: не настроен ключ OpenRouter. Ответы можно заполнить вручную.
              </p>
            </div>
          )}
          {!generating && generateState.kind === 'rate_limited' && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.05] px-4 py-3">
              <span className="material-symbols-outlined text-amber-400 text-lg" aria-hidden="true">
                hourglass_top
              </span>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {generateState.message} Лимит — 5 генераций в минуту, кнопка «Повторить» упрётся в
                него снова.
              </p>
            </div>
          )}
          {!generating && generateState.kind === 'error' && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error/[0.06] px-4 py-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-error text-lg" aria-hidden="true">
                  error
                </span>
                <p className="text-sm text-on-surface-variant">
                  {generateState.message ?? 'Не удалось сгенерировать черновик'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-error hover:text-error/80 transition-colors"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">
                  refresh
                </span>
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
            <SnapshotSummary
              snapshot={snapshot}
              hasAnyAnswer={hasAnyAnswer}
              onOpenQuestion={focusQuestion}
              onOpenBlock={focusBlock}
            />

            <InsightsStrip
              insights={insights}
              onOpen={focusQuestion}
              onShowDrafts={() => changeFilter('ai_draft')}
              hasDrafts={filterCounts.ai_draft > 0}
            />

            {!hasAnyAnswer && <EmptyExplainer onGenerate={() => void handleGenerate()} busy={generating} />}

            {/* Фильтр по статусу/источнику */}
            <FilterRow active={filter} counts={filterCounts} onChange={changeFilter} />

            <div className="space-y-3">
              {(data?.blocks ?? []).map((block) => (
                <BlockSection
                  key={block.id}
                  block={block}
                  open={!!openBlocks[block.id]}
                  filter={filter}
                  highlight={highlight}
                  pending={pending}
                  onResetFilter={() => changeFilter('all')}
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
  filter,
  highlight,
  pending,
  onToggle,
  onPatch,
  onResetFilter,
}: {
  block: Block
  open: boolean
  filter: FilterMode
  highlight: string | null
  pending: Record<string, boolean>
  onToggle: () => void
  onPatch: (key: string, action: PatchAction, text?: string) => Promise<boolean>
  onResetFilter: () => void
}) {
  const m = blockMeta(block.id)
  const answered = countAnswered(block)
  const total = block.questions.length

  const visibleQuestions = block.questions.filter((q) => matchesFilter(q, filter))
  const panelId = `mpanel-${block.id}`

  // Confirmed A1–A3 (and any confirmed answers) feed the market-data panel's tiles.
  const confirmedAnswers: ConfirmedAnswer[] = block.questions
    .filter((q) => q.answer?.status === 'confirmed' && (q.answer.text ?? '').trim())
    .map((q) => ({ key: q.key, text: q.answer!.text }))

  return (
    <section
      id={`mblock-${block.id}`}
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] shadow-card overflow-hidden scroll-mt-24"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-surface-container/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {/* Colored letter badge */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center border flex-shrink-0 font-mono font-black text-lg"
          style={{ background: m.tint, borderColor: m.border, color: m.color }}
          aria-hidden="true"
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
            {filter !== 'all' && (
              <span className="text-on-surface-variant/60"> · показано {visibleQuestions.length}</span>
            )}
          </span>
          <span
            className={`material-symbols-outlined text-xl text-on-surface-variant transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </div>
      </button>

      {open && (
        <div id={panelId} className="border-t border-white/[0.04] p-4 sm:p-5">
          {/* Compact live market-data panel */}
          <MarketDataPanel blockId={block.id} accent={m.color} confirmed={confirmedAnswers} />

          {visibleQuestions.length === 0 ? (
            <div className="flex items-center justify-between gap-3 flex-wrap py-2">
              <p className="text-xs text-on-surface-variant/60 italic">
                В этом блоке нет вопросов под выбранный фильтр
              </p>
              <button
                type="button"
                onClick={onResetFilter}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs font-medium hover:text-primary hover:border-primary/30 transition-colors"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">
                  filter_alt_off
                </span>
                Показать все
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleQuestions.map((q) => (
                <QuestionRow
                  key={q.key}
                  question={q}
                  accent={m.color}
                  highlighted={highlight === q.key}
                  saving={!!pending[q.key]}
                  onPatch={onPatch}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── Question row ─────────────────────────────────────────────────────────────

function QuestionRow({
  question,
  accent,
  highlighted,
  saving,
  onPatch,
}: {
  question: Question
  accent: string
  highlighted: boolean
  saving: boolean
  onPatch: (key: string, action: PatchAction, text?: string) => Promise<boolean>
}) {
  const { answer } = question
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(answer?.text ?? '')
  const [savingEdit, setSavingEdit] = useState(false)

  const startEdit = () => {
    setDraft(answer?.text ?? '')
    setEditing(true)
  }

  const save = async () => {
    const text = draft.trim()
    if (!text) return
    setSavingEdit(true)
    const ok = await onPatch(question.key, 'edit', text)
    setSavingEdit(false)
    if (ok) setEditing(false)
  }

  const status = answer?.status
  const busy = saving || savingEdit

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
    <div
      id={`mq-${question.key}`}
      tabIndex={-1}
      className={`rounded-xl p-4 transition-all scroll-mt-28 focus:outline-none ${cardClass} ${
        highlighted ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-surface-container-low' : ''
      }`}
    >
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
              onKeyDown={(e) => {
                // 50 вопросов — без клавиатуры это слишком много кликов мышью.
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void save()
                }
              }}
              rows={3}
              autoFocus
              placeholder="Ваш ответ…"
              aria-label={`Ответ на вопрос ${question.key}`}
              className="w-full rounded-lg bg-surface-container-high border border-white/[0.08] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !draft.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  className={`material-symbols-outlined text-sm ${busy ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                >
                  {busy ? 'progress_activity' : 'save'}
                </span>
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-on-surface-variant border border-white/[0.06] text-xs font-medium hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                Отмена
              </button>
              <span className="text-[10px] font-mono text-on-surface-variant/50">
                Ctrl+Enter — сохранить · Esc — отмена
              </span>
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
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                edit_note
              </span>
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
              {(status === 'draft' || status === 'disputed') && (
                <button
                  type="button"
                  onClick={() => void onPatch(question.key, 'confirm')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  <span
                    className={`material-symbols-outlined text-sm ${busy ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  >
                    {busy ? 'progress_activity' : 'check_circle'}
                  </span>
                  {/* Оспоренный ответ раньше был тупиком: вернуть его было нечем */}
                  {status === 'disputed' ? 'Снять спор и подтвердить' : 'Подтвердить'}
                </button>
              )}

              <button
                type="button"
                onClick={startEdit}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs font-medium hover:text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">
                  edit
                </span>
                Редактировать
              </button>

              {status !== 'disputed' && (
                <button
                  type="button"
                  onClick={() => void onPatch(question.key, 'dispute')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant/70 text-xs font-medium hover:text-error transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">
                    flag
                  </span>
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

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Status chip */}
      {status === 'draft' && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-400/40 bg-amber-400/[0.08] text-[10px] font-mono uppercase tracking-wide text-amber-300"
          title={
            confidence != null
              ? 'Уверенность модели в собственном ответе. Это не точность — ответ всё равно требует подтверждения.'
              : undefined
          }
        >
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
            auto_awesome
          </span>
          AI · предположение
          {confidence != null && (
            <span className="text-amber-200/80 tabular-nums">· {formatConfidence(confidence)}%</span>
          )}
        </span>
      )}
      {status === 'confirmed' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-primary/40 bg-primary/[0.08] text-[10px] font-mono uppercase tracking-wide text-primary">
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
            verified
          </span>
          Подтверждено
        </span>
      )}
      {status === 'disputed' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-error/40 bg-error/[0.08] text-[10px] font-mono uppercase tracking-wide text-error">
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
            flag
          </span>
          Оспорено
        </span>
      )}

      {/* Source chip: Эксперт / Владелец / AI */}
      <SourceChip source={source} />
    </div>
  )
}

function SourceChip({ source }: { source: AnswerSource }) {
  const c = SOURCE_CHIP[source]
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wide"
      style={{ color: c.color, background: c.bg, borderColor: c.border }}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
        {c.icon}
      </span>
      {c.label}
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
      <span className="material-symbols-outlined text-3xl text-error/80" aria-hidden="true">
        cloud_off
      </span>
      <p className="text-sm font-bold text-on-surface mt-3">Не удалось загрузить анализ рынка</p>
      <p className="text-xs text-on-surface-variant mt-1.5 max-w-md mx-auto leading-relaxed">
        Проверьте подключение и попробуйте снова. Если проблема повторяется — данные ещё не готовы на сервере.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl border border-white/[0.08] text-on-surface text-sm font-medium hover:border-primary/30 hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          refresh
        </span>
        Повторить
      </button>
    </div>
  )
}

function EmptyExplainer({ onGenerate, busy }: { onGenerate: () => void; busy: boolean }) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 text-center shadow-card">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/50" aria-hidden="true">
        checklist
      </span>
      <p className="text-sm font-bold text-on-surface mt-3">Пока нет ни одного ответа</p>
      <p className="text-xs text-on-surface-variant mt-1.5 max-w-lg mx-auto leading-relaxed">
        Ответы появляются двумя путями: вы пишете их сами в любом блоке ниже или запускаете
        AI-черновик и подтверждаете его. Точность черновика зависит от анкеты — отрасль, конкуренты,
        география.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        <Link
          href="/client/onboarding"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/[0.08] text-on-surface text-sm font-medium hover:border-primary/30 hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            assignment
          </span>
          Заполнить анкету
        </Link>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/15 text-primary border border-primary/30 text-sm font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            auto_awesome
          </span>
          Сгенерировать AI-черновик
        </button>
      </div>
    </div>
  )
}

// ── Filter row ───────────────────────────────────────────────────────────────

function FilterRow({
  active,
  counts,
  onChange,
}: {
  active: FilterMode
  counts: Record<FilterMode, number>
  onChange: (m: FilterMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mr-1">
        Фильтр
      </span>
      {FILTERS.map((f) => {
        const isActive = active === f.id
        const count = counts[f.id] ?? 0
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            aria-pressed={isActive}
            aria-label={`${f.label}: ${count}`}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              isActive
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-white/[0.12]'
            } ${count === 0 && f.id !== 'all' ? 'opacity-50' : ''}`}
          >
            {f.label}
            <span className="ml-1.5 font-mono tabular-nums opacity-70">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Snapshot summary (derived server-side from trustworthy answers only) ─────

interface SnapshotView {
  tam?: { value: string; caption: string }
  sam?: { value: string; delta: string }
  som?: { value: string; caption: string }
  trendWindow?: { open: boolean; caption: string }
  mainTrend?: string
  competitorWeakness?: string
  microSegment?: string
}

/** Снапшот приходит как JSON из БД — читаем только знакомые поля. */
function readSnapshot(raw: unknown): SnapshotView | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const pair = (k: string, second: 'caption' | 'delta') => {
    const v = rec[k]
    if (!v || typeof v !== 'object') return undefined
    const o = v as Record<string, unknown>
    const value = typeof o.value === 'string' ? o.value.trim() : ''
    if (!value) return undefined
    const rest = typeof o[second] === 'string' ? (o[second] as string).trim() : ''
    return { value, rest }
  }
  const text = (k: string) => {
    const v = rec[k]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }

  const out: SnapshotView = {}
  const tam = pair('tam', 'caption')
  if (tam) out.tam = { value: tam.value, caption: tam.rest }
  const sam = pair('sam', 'delta')
  if (sam) out.sam = { value: sam.value, delta: sam.rest }
  const som = pair('som', 'caption')
  if (som) out.som = { value: som.value, caption: som.rest }

  const tw = rec.trendWindow
  if (tw && typeof tw === 'object') {
    const o = tw as Record<string, unknown>
    const caption = typeof o.caption === 'string' ? o.caption.trim() : ''
    if (caption) out.trendWindow = { open: o.open === true, caption }
  }
  out.mainTrend = text('mainTrend')
  out.competitorWeakness = text('competitorWeakness')
  out.microSegment = text('microSegment')

  const filled = Object.values(out).some((v) => v != null)
  return filled ? out : null
}

function SnapshotSummary({
  snapshot,
  hasAnyAnswer,
  onOpenQuestion,
  onOpenBlock,
}: {
  snapshot: SnapshotView | null
  hasAnyAnswer: boolean
  onOpenQuestion: (blockId: string, key: string) => void
  onOpenBlock: (blockId: string) => void
}) {
  if (!snapshot) {
    if (!hasAnyAnswer) return null
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 shadow-card">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70 mb-2">
          Сводка по рынку
        </p>
        <p className="text-xs text-on-surface-variant leading-relaxed max-w-2xl">
          Сводка собирается только из ответов, которым можно верить: подтверждённых вами либо
          AI-черновиков с уверенностью от 50%. Пока таких нет. Подтвердите A1–A3 (TAM / SAM / SOM),
          A10 (окно тренда), C1 (главный тренд), E3 (слепые зоны конкурентов) и F5 (микросегмент) —
          и сводка появится здесь.
        </p>
      </section>
    )
  }

  const cards: Array<{ label: string; value: string; caption: string; block: string; key?: string }> = []
  if (snapshot.tam)
    cards.push({ label: 'TAM', value: snapshot.tam.value, caption: snapshot.tam.caption, block: 'A', key: 'A1' })
  if (snapshot.sam)
    cards.push({ label: 'SAM', value: snapshot.sam.value, caption: snapshot.sam.delta, block: 'A', key: 'A2' })
  if (snapshot.som)
    cards.push({ label: 'SOM', value: snapshot.som.value, caption: snapshot.som.caption, block: 'A', key: 'A3' })
  if (snapshot.trendWindow)
    cards.push({
      label: 'Окно тренда',
      value: snapshot.trendWindow.open ? 'Открыто' : 'Закрыто',
      caption: snapshot.trendWindow.caption,
      block: 'A',
      key: 'A10',
    })

  const notes: Array<{ label: string; text: string; block: string; key?: string }> = []
  if (snapshot.mainTrend)
    notes.push({ label: 'Главный тренд', text: snapshot.mainTrend, block: 'C', key: 'C1' })
  if (snapshot.competitorWeakness)
    notes.push({ label: 'Слабость конкурентов', text: snapshot.competitorWeakness, block: 'E' })
  if (snapshot.microSegment)
    notes.push({ label: 'Микросегмент ×10', text: snapshot.microSegment, block: 'F', key: 'F5' })

  const go = (block: string, key?: string) =>
    key ? onOpenQuestion(block, key) : onOpenBlock(block)

  return (
    <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 shadow-card">
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70 mb-1">
        Сводка по рынку
      </p>
      <p className="text-[11px] text-on-surface-variant/60 mb-3">
        Собрана из ваших подтверждённых ответов — нажмите, чтобы открыть источник
      </p>

      {cards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {cards.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => go(c.block, c.key)}
              aria-label={`${c.label}: ${c.value}. Открыть вопрос ${c.key ?? c.block}`}
              className="rounded-xl bg-surface-container px-3 py-2.5 border border-white/[0.04] text-left hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
            >
              <p className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant">
                {c.label} · {c.key ?? `блок ${c.block}`}
              </p>
              <p className="text-base font-mono font-black text-on-surface mt-0.5 break-words">
                {c.value}
              </p>
              {c.caption && (
                <p className="text-[10px] text-on-surface-variant/70 leading-snug mt-1 line-clamp-2">
                  {c.caption}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {notes.map((n) => (
            <button
              key={n.label}
              type="button"
              onClick={() => go(n.block, n.key)}
              aria-label={`${n.label}. Открыть ${n.key ?? `блок ${n.block}`}`}
              className="rounded-xl bg-surface-container px-3 py-2.5 border border-white/[0.04] text-left hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
            >
              <p className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant">
                {n.label} · {n.key ?? `блок ${n.block}`}
              </p>
              <p className="text-xs text-on-surface leading-snug mt-1 line-clamp-3">{n.text}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Insights strip ───────────────────────────────────────────────────────────

interface Insight {
  blockId: string
  questionKey: string
  questionText: string
  excerpt: string
  source: AnswerSource
}

function buildInsights(blocks: Block[]): Insight[] {
  const rows: Array<Insight & { confidence: number; updated: number }> = []
  for (const block of blocks) {
    for (const q of block.questions) {
      const a = q.answer
      if (!a || a.status !== 'confirmed') continue
      if (a.source !== 'expert' && a.source !== 'ai') continue
      const text = (a.text ?? '').trim()
      if (!text) continue
      rows.push({
        blockId: block.id,
        questionKey: q.key,
        questionText: q.text,
        excerpt: text,
        source: a.source,
        confidence: a.confidence == null ? 0 : a.confidence <= 1 ? a.confidence * 100 : a.confidence,
        updated: a.updated_at ? Date.parse(a.updated_at) || 0 : 0,
      })
    }
  }
  // Most confident first, then most recent.
  rows.sort((x, y) => y.confidence - x.confidence || y.updated - x.updated)
  return rows.map(({ confidence: _c, updated: _u, ...rest }) => rest)
}

const INSIGHTS_PREVIEW = 4

function InsightsStrip({
  insights,
  onOpen,
  onShowDrafts,
  hasDrafts,
}: {
  insights: Insight[]
  onOpen: (blockId: string, key: string) => void
  onShowDrafts: () => void
  hasDrafts: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? insights : insights.slice(0, INSIGHTS_PREVIEW)
  const hidden = insights.length - visible.length

  return (
    <section>
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70 mb-2">
        Инсайты · подтверждённые ответы
      </p>
      {insights.length === 0 ? (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 text-center">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant/40" aria-hidden="true">
            lightbulb
          </span>
          <p className="text-xs text-on-surface-variant mt-2 max-w-md mx-auto leading-relaxed">
            Сюда попадают ответы экспертов и AI после того, как вы нажмёте «Подтвердить». Пока
            подтверждённых нет.
          </p>
          {hasDrafts && (
            <button
              type="button"
              onClick={onShowDrafts}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface-variant text-xs font-medium hover:text-primary hover:border-primary/30 transition-colors"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                auto_awesome
              </span>
              Открыть черновики AI
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {visible.map((ins) => {
              const m = blockMeta(ins.blockId)
              return (
                <button
                  key={ins.questionKey}
                  type="button"
                  onClick={() => onOpen(ins.blockId, ins.questionKey)}
                  aria-label={`Инсайт по вопросу ${ins.questionKey} — открыть вопрос`}
                  className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 flex flex-col gap-2 text-left hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-md border text-[11px] font-mono font-black"
                      style={{ background: m.tint, borderColor: m.border, color: m.color }}
                      aria-hidden="true"
                    >
                      {ins.blockId}
                    </span>
                    <SourceChip source={ins.source} />
                    <span
                      className="material-symbols-outlined text-sm text-on-surface-variant/50 ml-auto"
                      aria-hidden="true"
                    >
                      north_east
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-snug line-clamp-2">
                    {ins.questionText}
                  </p>
                  <p className="text-sm text-on-surface leading-relaxed line-clamp-3">{ins.excerpt}</p>
                </button>
              )
            })}
          </div>
          {(hidden > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
              {expanded ? 'Свернуть' : `Показать все (${insights.length})`}
            </button>
          )}
        </>
      )}
    </section>
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
