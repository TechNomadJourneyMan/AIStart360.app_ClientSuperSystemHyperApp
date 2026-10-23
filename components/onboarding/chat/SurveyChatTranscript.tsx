'use client'

/**
 * «Беседа с ИИ» for staff (spec §8.8, §10): the client's questionnaire chat,
 * read-only — every message with the question it is about, the cards with
 * their outcome (записано / пропущено / устарело), the field-helper turns and
 * the escalations. GIGA reads /api/giga-admin/users/[id]/survey-chat, the
 * expert cabinet /api/expert/clients/[id]/survey-chat.
 */
import { useEffect, useState } from 'react'
import { ChatMessages } from './ChatMessages'
import type { TranscriptConversation } from '@/lib/survey/chat/transcript'

const fmt = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function SurveyChatTranscriptView({ conversations }: { conversations: readonly TranscriptConversation[] }) {
  if (!conversations.length) {
    return <p className="text-sm text-on-surface-variant">Клиент ещё не пользовался ИИ-помощником анкеты.</p>
  }
  return (
    <div className="space-y-6">
      <p className="text-xs text-on-surface-variant">Только чтение. В анкету попадало только то, что клиент подтвердил кнопкой «Записать».</p>
      {conversations.map((c) => {
        const labels = new Map(c.messages.filter((m) => m.key).map((m) => [m.key as string, m.keyLabel]))
        return (
          <section key={c.id} aria-label={c.title ?? 'Беседа'} className="rounded-2xl border border-white/[0.06] p-4">
            <header className="mb-3 flex flex-wrap items-baseline gap-x-3 text-xs text-on-surface-variant">
              <h3 className="text-sm font-semibold text-on-surface">{c.title ?? 'Беседа'}</h3>
              <span>{fmt(c.createdAt)}</span>
              <span>Записано: {c.saved}</span>
            </header>
            <ChatMessages messages={c.messages} readOnly keyLabel={(k) => labels.get(k) ?? k} />
          </section>
        )
      })}
    </div>
  )
}

export function SurveyChatTranscript({ url }: { url: string }) {
  const [data, setData] = useState<TranscriptConversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch(url, { credentials: 'include' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return
        if (!ok || !j?.ok) setError(j?.error || 'Не удалось загрузить беседу')
        else setData(j.data?.conversations ?? [])
      })
      .catch(() => { if (alive) setError('Не удалось загрузить беседу') })
    return () => { alive = false }
  }, [url])
  if (error) return <p role="alert" className="text-sm text-error">{error}</p>
  if (!data) return <p className="text-sm text-on-surface-variant">Загружаем беседу…</p>
  return <SurveyChatTranscriptView conversations={data} />
}

/** A section «Беседа с ИИ-помощником» that loads the transcript on demand (expert cabinet). */
export function SurveyChatTranscriptSection({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="material-symbols-outlined text-[18px] text-primary/70" aria-hidden="true">forum</span>
        <h2 className="flex-1 text-sm font-semibold text-on-surface">Беседа с ИИ-помощником анкеты</h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          className="min-h-[36px] rounded-lg border border-white/[0.08] px-3 text-xs text-on-surface-variant hover:text-primary">
          {open ? 'Скрыть' : 'Открыть беседу'}
        </button>
      </div>
      {open && <div className="mt-4"><SurveyChatTranscript url={url} /></div>}
    </section>
  )
}
