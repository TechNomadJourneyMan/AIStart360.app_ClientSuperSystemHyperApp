'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  RefreshCw,
  Lightbulb,
  Sparkles,
  ChevronDown,
  Save,
  AlertTriangle,
  CheckCircle,
  Building2,
  User,
} from 'lucide-react'

// ─── Types (mirror /api/giga-admin/market-analysis responses) ─────────────────

interface MarketClient {
  id: string
  full_name: string | null
  organization: string | null
  answered: number
  confirmed: number
}

type AnswerSource = 'ai' | 'user' | 'expert'
type AnswerStatus = 'draft' | 'confirmed' | 'disputed'

interface QuestionAnswer {
  text: string | null
  source: AnswerSource
  status: AnswerStatus
  confidence: number | null
  updated_at: string | null
}

interface MarketQuestion {
  key: string
  idx: number
  text: string
  answer: QuestionAnswer | null
}

interface MarketBlock {
  id: string
  code: string
  title: string
  questions: MarketQuestion[]
}

interface Progress {
  answered: number
  confirmed: number
  total: number
}

const TOTAL = 50

// ─── Source / status chips ────────────────────────────────────────────────────

function SourceChip({ source }: { source: AnswerSource }) {
  const map: Record<AnswerSource, { label: string; cls: string }> = {
    ai: { label: 'AI', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
    user: { label: 'Владелец', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/20' },
    expert: { label: 'Эксперт', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/25' },
  }
  const m = map[source]
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${m.cls}`}>
      {m.label}
    </span>
  )
}

function StatusMarker({ status }: { status: AnswerStatus }) {
  if (status === 'confirmed') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <CheckCircle size={11} /> подтверждено
      </span>
    )
  }
  if (status === 'disputed') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-400">
        <AlertTriangle size={11} /> спорно
      </span>
    )
  }
  return <span className="text-[10px] text-slate-600">черновик</span>
}

// ─── Question row (inline editor) ─────────────────────────────────────────────

function QuestionRow({
  userId,
  q,
  onSaved,
}: {
  userId: string
  q: MarketQuestion
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(q.answer?.text ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the editor when the underlying answer changes (e.g. after AI generate).
  useEffect(() => {
    setDraft(q.answer?.text ?? '')
  }, [q.answer?.text, q.answer?.updated_at])

  const dirty = draft.trim() !== (q.answer?.text ?? '').trim()

  const save = async () => {
    if (draft.trim().length === 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/giga-admin/market-analysis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, question_key: q.key, text: draft.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Не удалось сохранить')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-[10px] font-bold text-blue-400/80 tabular-nums mt-0.5 flex-shrink-0">
          {q.key}
        </span>
        <p className="text-xs text-slate-300 leading-snug">{q.text}</p>
      </div>

      {/* Current answer meta */}
      {q.answer && (
        <div className="flex items-center gap-2 flex-wrap mb-2 pl-6">
          <SourceChip source={q.answer.source} />
          <StatusMarker status={q.answer.status} />
          {q.answer.source === 'ai' && typeof q.answer.confidence === 'number' && (
            <span className="text-[10px] text-slate-600">
              увер. {Math.round(q.answer.confidence * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="pl-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Напишите ответ вручную…"
          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]
            text-xs text-slate-200 placeholder:text-slate-700 resize-y
            focus:outline-none focus:border-teal-500/40 transition-all"
        />
        <div className="flex items-center justify-between mt-1.5">
          {error ? (
            <span className="text-[10px] text-red-400">{error}</span>
          ) : (
            <span className="text-[10px] text-slate-600">
              {dirty ? 'Не сохранено' : ''}
            </span>
          )}
          <motion.button
            onClick={save}
            disabled={saving || draft.trim().length === 0 || !dirty}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
              text-teal-300 bg-teal-500/15 border border-teal-500/25
              hover:bg-teal-500/25 transition-all
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            Сохранить как эксперт
          </motion.button>
        </div>
      </div>
    </div>
  )
}

// ─── Block accordion ──────────────────────────────────────────────────────────

function BlockAccordion({
  userId,
  block,
  open,
  onToggle,
  onSaved,
}: {
  userId: string
  block: MarketBlock
  open: boolean
  onToggle: () => void
  onSaved: () => void
}) {
  const answered = block.questions.filter((q) => (q.answer?.text ?? '').trim().length > 0).length
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/20
          flex items-center justify-center text-xs font-bold text-blue-300 flex-shrink-0">
          {block.id}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-200 truncate">{block.title}</p>
        </div>
        <span className="text-[10px] text-slate-500 tabular-nums">
          {answered}/{block.questions.length}
        </span>
        <ChevronDown
          size={15}
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 space-y-2">
              {block.questions.map((q) => (
                <QuestionRow key={q.key} userId={userId} q={q} onSaved={onSaved} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Right pane: selected client's checklist ──────────────────────────────────

function ClientChecklist({ client }: { client: MarketClient }) {
  const [blocks, setBlocks] = useState<MarketBlock[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openBlock, setOpenBlock] = useState<string | null>('A')
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/giga-admin/market-analysis?user_id=${encodeURIComponent(client.id)}`,
      )
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Ошибка загрузки')
      setBlocks(data.data.blocks)
      setProgress(data.data.progress)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [client.id])

  useEffect(() => {
    load()
  }, [load])

  const generate = async () => {
    if (generating) return
    setGenerating(true)
    setGenMsg(null)
    try {
      const res = await fetch('/api/giga-admin/market-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: client.id, action: 'generate' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        if (data?.error === 'ai_not_configured') {
          setGenMsg({
            kind: 'error',
            text: 'AI-генерация недоступна: провайдер не настроен (OpenRouter API-ключ отсутствует).',
          })
          return
        }
        throw new Error(data?.error || 'Не удалось сгенерировать')
      }
      setGenMsg({
        kind: 'ok',
        text: `Сгенерировано черновиков: ${data.data.generated}. Пропущено подтверждённых: ${data.data.skipped_confirmed}.`,
      })
      await load()
    } catch (e) {
      setGenMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Ошибка генерации' })
    } finally {
      setGenerating(false)
    }
  }

  const name = client.organization || client.full_name || 'Клиент'
  const answered = progress?.answered ?? 0
  const confirmed = progress?.confirmed ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-base font-bold text-slate-100">{name}</h2>
        {client.full_name && client.organization && (
          <p className="text-xs text-slate-500">{client.full_name}</p>
        )}
      </div>

      {/* Generate + progress */}
      <div className="mb-4 space-y-3">
        <motion.button
          onClick={generate}
          disabled={generating}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
            text-amber-300 bg-amber-500/15 border border-amber-500/25
            hover:bg-amber-500/25 transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <RefreshCw size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} />
          )}
          Сгенерировать AI-черновики
        </motion.button>

        {genMsg && (
          <div
            className={`flex items-start gap-2 p-3 rounded-xl border text-xs ${
              genMsg.kind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}
          >
            {genMsg.kind === 'ok' ? (
              <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            )}
            <span>{genMsg.text}</span>
          </div>
        )}

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1 text-[11px]">
            <span className="text-slate-500">
              <span className="text-emerald-400 font-semibold">{confirmed}</span> подтверждено
              {' · '}
              <span className="text-slate-300 font-semibold">{answered}</span> отвечено
            </span>
            <span className="text-slate-600 tabular-nums">{answered}/{TOTAL}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(confirmed / TOTAL) * 100}%` }}
              transition={{ duration: 0.6 }}
              className="h-full bg-emerald-500"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(Math.max(0, answered - confirmed) / TOTAL) * 100}%` }}
              transition={{ duration: 0.6 }}
              className="h-full bg-blue-500/60"
            />
          </div>
        </div>
      </div>

      {/* Blocks */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={18} className="text-slate-600 animate-spin mr-2" />
            <span className="text-sm text-slate-600">Загрузка чек-листа…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 rounded-2xl
            bg-white/[0.02] border border-white/[0.06] border-dashed">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={load} className="mt-3 text-xs text-blue-400 hover:text-blue-300">
              Попробовать снова
            </button>
          </div>
        ) : answered === 0 ? (
          <>
            <div className="flex flex-col items-center justify-center py-10 rounded-2xl
              bg-white/[0.02] border border-white/[0.06] border-dashed mb-2">
              <Lightbulb size={28} className="text-slate-700 mb-2" />
              <p className="text-sm text-slate-500 text-center px-4">
                Ответов пока нет — сгенерируйте AI-черновик или заполните вручную
              </p>
            </div>
            {blocks.map((block) => (
              <BlockAccordion
                key={block.id}
                userId={client.id}
                block={block}
                open={openBlock === block.id}
                onToggle={() => setOpenBlock(openBlock === block.id ? null : block.id)}
                onSaved={load}
              />
            ))}
          </>
        ) : (
          blocks.map((block) => (
            <BlockAccordion
              key={block.id}
              userId={client.id}
              block={block}
              open={openBlock === block.id}
              onToggle={() => setOpenBlock(openBlock === block.id ? null : block.id)}
              onSaved={load}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export function MarketInsightsModule() {
  const [clients, setClients] = useState<MarketClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/giga-admin/market-analysis')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Ошибка загрузки клиентов')
      setClients(data.data.clients)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const filtered = clients.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (c.full_name ?? '').toLowerCase().includes(q) ||
      (c.organization ?? '').toLowerCase().includes(q)
    )
  })

  const selected = clients.find((c) => c.id === selectedId) ?? null

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Инсайты рынка</h1>
          <p className="text-sm text-slate-500 mt-1">
            Чек-лист 50 вопросов — заполняйте вручную или генерируйте через ИИ для каждого клиента
          </p>
        </div>
        <motion.button
          onClick={fetchClients}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
            text-slate-400 bg-white/[0.05] border border-white/[0.08]
            hover:text-slate-200 hover:bg-white/[0.08] transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Обновить
        </motion.button>
      </div>

      {/* Two-pane layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Left: client list */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3 flex flex-col
          lg:max-h-[70vh]">
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени / организации…"
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08]
                text-sm text-slate-200 placeholder:text-slate-700
                focus:outline-none focus:border-blue-500/40 transition-all"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={16} className="text-slate-600 animate-spin" />
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-xs text-red-400">{error}</p>
                <button onClick={fetchClients} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                  Повторить
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <User size={24} className="text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-600">
                  {clients.length === 0 ? 'Клиентов пока нет' : 'Нет совпадений'}
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const isActive = c.id === selectedId
                const label = c.organization || c.full_name || 'Без названия'
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left
                      transition-all ${
                        isActive
                          ? 'bg-blue-500/15 border border-blue-500/25'
                          : 'border border-transparent hover:bg-white/[0.04]'
                      }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/30 to-teal-500/30
                      border border-white/[0.1] flex items-center justify-center flex-shrink-0
                      text-[11px] font-bold text-blue-300">
                      {label.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold truncate ${isActive ? 'text-blue-200' : 'text-slate-300'}`}>
                        {label}
                      </p>
                      {c.full_name && c.organization && (
                        <p className="text-[10px] text-slate-600 truncate">{c.full_name}</p>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                        c.answered > 0
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                          : 'bg-slate-500/15 text-slate-500 border-slate-500/15'
                      }`}
                    >
                      {c.answered}/{TOTAL}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: checklist */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 lg:max-h-[70vh]
          lg:overflow-hidden">
          {selected ? (
            <ClientChecklist key={selected.id} client={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
              <Building2 size={32} className="text-slate-700 mb-3" />
              <p className="text-sm text-slate-500">
                Выберите клиента слева, чтобы открыть его чек-лист рынка
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
