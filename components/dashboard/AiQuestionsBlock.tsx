'use client'

/**
 * AI Questions block — mockup-inspired section.
 * Sonnet generates 3-6 clarifying questions based on data gaps.
 * User answers inline; answers feed back into Точка А scoring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AiQuestion {
  id: string
  category: string
  question: string
  context: string
  status: 'pending' | 'answered'
  answer?: string | null
  generated_at: string
  answered_at?: string | null
}

const CATEGORY_COLORS: Record<string, string> = {
  'финансы':   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'продажи':   'bg-primary/15 text-primary border-primary/30',
  'клиенты':   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'операции':  'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'маркетинг': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'стратегия': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  'команда':   'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

type FilterMode = 'all' | 'pending' | 'answered'

export function AiQuestionsBlock() {
  const [questions, setQuestions] = useState<AiQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/ai-questions', { cache: 'no-store' })
      const data = await res.json() as { ok: boolean; questions?: AiQuestion[] }
      if (data.ok && data.questions) {
        setQuestions(data.questions)
        const d: Record<string, string> = {}
        for (const q of data.questions) if (q.answer) d[q.id] = q.answer
        setDrafts(d)
      }
    } catch {/* silent */}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/ai-questions/generate', { method: 'POST' })
      const data = await res.json() as { ok: boolean; questions?: AiQuestion[]; error?: string }
      if (data.ok && data.questions) {
        setQuestions(data.questions)
        setDrafts({})
      } else {
        setError(data.error ?? 'Не удалось сгенерировать')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setGenerating(false)
    }
  }, [])

  const saveAnswer = useCallback(async (id: string) => {
    const answer = drafts[id] ?? ''
    setSavingId(id)
    try {
      const res = await fetch('/api/v1/ai-questions/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: id, answer }),
      })
      const data = await res.json() as { ok: boolean; question?: AiQuestion }
      if (data.ok && data.question) {
        setQuestions((prev) => prev.map((q) => q.id === id ? data.question! : q))
      }
    } catch {/* silent */}
    finally { setSavingId(null) }
  }, [drafts])

  const filtered = useMemo(() => {
    if (filter === 'pending') return questions.filter((q) => q.status === 'pending')
    if (filter === 'answered') return questions.filter((q) => q.status === 'answered')
    return questions
  }, [filter, questions])

  const pendingCount = questions.filter((q) => q.status === 'pending').length
  const answeredCount = questions.filter((q) => q.status === 'answered').length

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em]">
            Уточняющие вопросы AI
          </p>
          {questions.length > 0 && (
            <span className="text-[10px] font-mono text-on-surface-variant">
              {answeredCount}/{questions.length} отвечено
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {questions.length > 0 && (
            <div className="inline-flex bg-surface-container-low rounded-lg border border-white/[0.06] p-0.5">
              {(['all', 'pending', 'answered'] as FilterMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFilter(mode)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors ${
                    filter === mode ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {mode === 'all' ? `Все · ${questions.length}` : mode === 'pending' ? `Открытые · ${pendingCount}` : `Готовые · ${answeredCount}`}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-[11px] font-mono hover:bg-primary/20 disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[14px] ${generating ? 'animate-spin' : ''}`}>
              {generating ? 'progress_activity' : 'auto_awesome'}
            </span>
            {generating ? 'AI думает…' : questions.length > 0 ? 'Перегенерировать' : 'Сгенерировать вопросы'}
          </button>
        </div>
      </header>

      {error && (
        <div className="text-xs text-error bg-error/10 border border-error/30 rounded-lg p-2">
          {error}
        </div>
      )}

      {loading && questions.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-surface-container-low p-6 text-center">
          <span className="material-symbols-outlined text-2xl text-primary animate-spin">progress_activity</span>
        </div>
      )}

      {!loading && questions.length === 0 && !generating && (
        <div className="rounded-2xl border border-white/[0.06] border-dashed bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined text-3xl text-primary/40 mb-2">help_outline</span>
          <h3 className="text-sm font-medium text-on-surface">AI ещё не предлагал вопросов</h3>
          <p className="text-xs text-on-surface-variant mt-1 max-w-md mx-auto">
            Нажми «Сгенерировать вопросы» — Sonnet проанализирует пробелы в твоих данных
            и предложит 3-6 коротких уточнений для точной диагностики.
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((q) => {
            const colorClass = CATEGORY_COLORS[q.category] ?? 'bg-white/5 text-on-surface-variant border-white/10'
            const isAnswered = q.status === 'answered'
            return (
              <div
                key={q.id}
                className={`rounded-xl border bg-surface-container-low p-4 ${
                  isAnswered ? 'border-primary/20 border-l-[3px] border-l-primary' : 'border-amber-500/20 border-l-[3px] border-l-amber-400'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border border-purple-500/30 bg-purple-500/15 text-purple-300">
                    <span className="material-symbols-outlined text-[11px]">smart_toy</span>
                    AI
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono uppercase border ${colorClass}`}>
                    {q.category}
                  </span>
                  <span className={`text-[10px] font-mono ml-auto ${isAnswered ? 'text-primary' : 'text-amber-300'}`}>
                    {isAnswered ? '✓ Готово' : 'Ждёт ответа'}
                  </span>
                </div>
                <p className="text-sm text-on-surface font-medium mb-1">{q.question}</p>
                {q.context && (
                  <p className="text-[11px] text-on-surface-variant/80 italic mb-3">{q.context}</p>
                )}
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <textarea
                    value={drafts[q.id] ?? ''}
                    placeholder={isAnswered ? '' : 'Ваш ответ…'}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    rows={2}
                    className="flex-1 bg-surface-container border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-y min-h-[42px]"
                  />
                  <button
                    onClick={() => saveAnswer(q.id)}
                    disabled={savingId === q.id || (drafts[q.id] ?? '') === (q.answer ?? '')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <span className={`material-symbols-outlined text-[14px] ${savingId === q.id ? 'animate-spin' : ''}`}>
                      {savingId === q.id ? 'progress_activity' : 'check'}
                    </span>
                    {isAnswered ? 'Обновить' : 'Сохранить'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
