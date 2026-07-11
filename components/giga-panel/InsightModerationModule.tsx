'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  RefreshCw,
  Check,
  X,
  Pencil,
  Sparkles,
  AlertTriangle,
  Inbox,
} from 'lucide-react'

/**
 * Очередь модерации клиентских AI-инсайтов (R2, ТЗ §5.5).
 *
 * ИИ генерирует инсайты в статусе «скрыт от клиента» (visible_to_user=false,
 * миграция 060). Здесь эксперт видит очередь, может отредактировать текст
 * ответа, опубликовать (инсайт появляется в ленте клиента) или отклонить.
 */

interface PendingInsight {
  id: string
  user_id: string
  category: string
  question_text: string
  answer_text: string | null
  status: string
  created_at: string
  source_meta: { model?: string; confidence?: number | null } | null
  user: { email: string | null; full_name: string | null }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function InsightCard({
  insight,
  onDone,
}: {
  insight: PendingInsight
  onDone: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [answerDraft, setAnswerDraft] = useState(insight.answer_text ?? '')
  const [busy, setBusy] = useState<null | 'publish' | 'reject' | 'edit'>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (action: 'publish' | 'reject' | 'edit') => {
    setBusy(action)
    setError(null)
    try {
      const body: Record<string, unknown> = { action }
      if (action === 'edit') body.answer_text = answerDraft.trim()
      const res = await fetch(`/api/giga-admin/insights/${insight.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      if (action === 'edit') {
        setEditing(false)
      } else {
        onDone(insight.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setBusy(null)
    }
  }

  const confidence = insight.source_meta?.confidence
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/20">
          {insight.category}
        </span>
        <span className="text-[11px] text-slate-400">
          {insight.user.full_name || insight.user.email || insight.user_id}
        </span>
        {typeof confidence === 'number' && (
          <span className="text-[10px] text-slate-500">уверенность ИИ: {Math.round(confidence * 100)}%</span>
        )}
        <span className="ml-auto text-[10px] text-slate-600">{formatDate(insight.created_at)}</span>
      </div>

      <p className="text-sm font-medium text-slate-200 mb-2">{insight.question_text}</p>

      {editing ? (
        <textarea
          value={answerDraft}
          onChange={(e) => setAnswerDraft(e.target.value)}
          rows={4}
          className="w-full rounded-lg bg-black/30 border border-white/10 text-sm text-slate-200 p-3 mb-3 focus:outline-none focus:border-blue-500/40"
        />
      ) : (
        insight.answer_text && (
          <p className="text-sm text-slate-400 mb-3 whitespace-pre-wrap">
            <Sparkles size={12} className="inline mr-1 text-violet-400" />
            {insight.answer_text}
          </p>
        )
      )}

      {error && (
        <p className="text-xs text-red-400 mb-2 flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <button
              onClick={() => act('edit')}
              disabled={busy !== null || answerDraft.trim().length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/25 hover:bg-blue-500/30 disabled:opacity-40"
            >
              {busy === 'edit' ? 'Сохраняю…' : 'Сохранить правку'}
            </button>
            <button
              onClick={() => { setEditing(false); setAnswerDraft(insight.answer_text ?? '') }}
              disabled={busy !== null}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => act('publish')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40"
            >
              <Check size={13} /> {busy === 'publish' ? 'Публикую…' : 'Опубликовать'}
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-40"
            >
              <Pencil size={13} /> Редактировать
            </button>
            <button
              onClick={() => act('reject')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40"
            >
              <X size={13} /> {busy === 'reject' ? 'Отклоняю…' : 'Отклонить'}
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

export function InsightModerationModule() {
  const [items, setItems] = useState<PendingInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/giga-admin/insights?scope=pending')
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; items?: PendingInsight[]; error?: string }
        | null
      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error === 'migration_060_required'
            ? 'Миграция 060 не применена — очередь модерации недоступна'
            : data?.error || `HTTP ${res.status}`
        )
      }
      setItems(data.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQueue()
  }, [fetchQueue])

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id))

  return (
    <div>
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-400" />
          <h2 className="text-base md:text-lg font-semibold text-slate-200">Модерация ИИ-инсайтов</h2>
          {items.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">
              {items.length}
            </span>
          )}
        </div>
        <button
          onClick={fetchQueue}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-white/[0.06] disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-4 max-w-2xl">
        Инсайты, сгенерированные ИИ по данным анкет и диагностики, не показываются клиенту
        автоматически: сначала их проверяет эксперт. Публикация делает инсайт видимым в ленте
        клиента; отклонение скрывает его навсегда. Все решения записываются в журнал действий.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <RefreshCw size={15} className="animate-spin" /> Загрузка очереди…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
          <button onClick={fetchQueue} className="ml-auto text-xs underline">повторить</button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Inbox size={26} className="mx-auto mb-2 text-slate-600" />
          <p className="text-sm text-slate-400">Очередь пуста — все инсайты проверены ✓</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-3 md:gap-4">
          {items.map((insight) => (
            <InsightCard key={insight.id} insight={insight} onDone={removeItem} />
          ))}
        </div>
      )}
    </div>
  )
}
