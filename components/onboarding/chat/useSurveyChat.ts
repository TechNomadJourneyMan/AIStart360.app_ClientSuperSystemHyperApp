'use client'

/**
 * useSurveyChat — the questionnaire AI helper in the browser (spec §8): the
 * chat mode and the field «Помощник» share it. The server does everything
 * (queue, model, number guard, cards); the hook keeps the messages, sends
 * turns and decides cards. Any screen can reuse it:
 *
 *   const chat = useSurveyChat()                       // the chat mode
 *   const helper = useFieldHelper(key, onApply)        // a field of a form
 *
 * The transport is injectable: the dev preview plays a recorded scenario
 * without network.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fromAnswerEnvelope } from '@/lib/survey/answer-value'
import type { ChatBudgetDTO, ChatMessageDTO, ChatProgressDTO, ChatQuestionDTO, ChatScope, ProposalDTO } from '@/lib/survey/chat/types'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

export type ChatSendAction = 'explain' | 'where' | 'skip' | 'unknown' | 'approx' | 'start' | 'restart' | 'next'

export interface ChatViewData {
  conversationId: string | null
  scope: ChatScope | null
  needsScope: boolean
  messages: ChatMessageDTO[]
  question: ChatQuestionDTO | null
  progress: ChatProgressDTO
  budget: ChatBudgetDTO
}

export interface ChatPostData {
  conversationId: string
  scope: ChatScope | null
  messages: ChatMessageDTO[]
  question: ChatQuestionDTO | null
  progress: ChatProgressDTO
  budget: ChatBudgetDTO
}

export interface ChatTransport {
  load: () => Promise<ChatViewData>
  post: (body: { message?: string; action?: ChatSendAction; scope?: ChatScope; focusKey?: string }) => Promise<ChatPostData>
  decide: (id: string, body: { decision: 'apply' | 'reject'; edited_value?: unknown }) => Promise<{ status: string; attribution?: Record<string, AnswerAttribution> }>
  escalate: (body: { key: string | null; text: string }) => Promise<{ message: string }>
}

class ChatError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new ChatError('Нет связи — беседа продолжится, когда сеть вернётся. Можно заполнить в форме: ответы сохранятся на устройстве.')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw new ChatError(json?.error || 'Помощник не ответил — попробуйте ещё раз.')
  return json.data as T
}

export const fetchTransport: ChatTransport = {
  load: () => call<ChatViewData>('/api/v1/survey/chat'),
  post: (body) => call<ChatPostData>('/api/v1/survey/chat', { method: 'POST', body: JSON.stringify(body) }),
  decide: (id, body) => call(`/api/v1/ai/actions/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) }),
  escalate: (body) => call('/api/v1/survey/chat/escalate', { method: 'POST', body: JSON.stringify(body) }),
}

export interface SurveyChatState {
  loading: boolean
  sending: boolean
  error: string | null
  messages: ChatMessageDTO[]
  question: ChatQuestionDTO | null
  progress: ChatProgressDTO | null
  budget: ChatBudgetDTO | null
  needsScope: boolean
  scope: ChatScope | null
}

export function useSurveyChat(opts: { focusKey?: string | null; transport?: ChatTransport; autoload?: boolean } = {}) {
  const transport = opts.transport ?? fetchTransport
  const focusKey = opts.focusKey ?? null
  const [state, setState] = useState<SurveyChatState>({
    loading: opts.autoload !== false && !focusKey, sending: false, error: null, messages: [], question: null, progress: null, budget: null, needsScope: false, scope: null,
  })
  const busy = useRef(false)

  const apply = useCallback((data: ChatPostData) => {
    setState((s) => ({
      ...s, sending: false, error: null, messages: [...s.messages, ...data.messages], question: data.question,
      progress: data.progress, budget: data.budget, scope: data.scope, needsScope: data.scope === null && !focusKey,
    }))
  }, [focusKey])

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const v = await transport.load()
      setState((s) => ({ ...s, loading: false, error: null, messages: v.messages, question: v.question, progress: v.progress, budget: v.budget, needsScope: v.needsScope, scope: v.scope }))
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Не удалось загрузить беседу' }))
    }
  }, [transport])

  useEffect(() => {
    if (opts.autoload !== false && !focusKey) void load()
  }, [load, focusKey, opts.autoload])

  const post = useCallback(async (body: { message?: string; action?: ChatSendAction; scope?: ChatScope }) => {
    if (busy.current) return false
    busy.current = true
    setState((s) => ({ ...s, sending: true, error: null }))
    try {
      apply(await transport.post({ ...body, ...(focusKey ? { focusKey } : {}) }))
      return true
    } catch (e) {
      setState((s) => ({ ...s, sending: false, error: e instanceof Error ? e.message : 'Помощник не ответил' }))
      return false
    } finally {
      busy.current = false
    }
  }, [apply, transport, focusKey])

  const setProposalStatus = (id: string | null, key: string, status: ProposalDTO['status']) => {
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => (m.proposal && m.proposal.key === key && m.proposal.id === id ? { ...m, proposal: { ...m.proposal, status } } : m)),
    }))
  }

  /** «Записать» / «Исправить» / «Пропустить» on a chat card (server write). */
  const decide = useCallback(async (msg: ChatMessageDTO, decision: 'apply' | 'reject', editedValue?: unknown) => {
    const p = msg.proposal
    if (!p?.id) return false
    setProposalStatus(p.id, p.key, 'applying')
    try {
      const out = await transport.decide(p.id, { decision, ...(editedValue !== undefined ? { edited_value: editedValue } : {}) })
      setProposalStatus(p.id, p.key, out.status === 'applied' ? 'applied' : 'rejected')
      // After «Записать» the chat asks the next question; «Пропустить» puts the question aside.
      await post(decision === 'apply' ? { action: 'next' } : { action: 'skip' })
      return true
    } catch (e) {
      const text = e instanceof Error ? e.message : ''
      setProposalStatus(p.id, p.key, /устарел/i.test(text) ? 'expired' : 'failed')
      setState((s) => ({ ...s, error: text || 'Не удалось записать — повторите' }))
      return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, post])

  const escalate = useCallback(async (key: string | null, text: string) => {
    try {
      const out = await transport.escalate({ key, text })
      setState((s) => ({
        ...s,
        messages: [...s.messages, { id: `esc-${Date.now()}`, role: 'assistant', content: out.message, kind: 'escalated', key, focus: !!focusKey, proposal: null, createdAt: new Date().toISOString(), link: { href: '/client/messages', label: 'Открыть «Сообщения»' } }],
      }))
      return true
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Не удалось передать вопрос' }))
      return false
    }
  }, [transport, focusKey])

  return {
    ...state,
    load,
    start: (scope: ChatScope) => post({ action: 'start', scope }),
    restart: (scope: ChatScope) => post({ action: 'restart', scope }),
    send: (message: string) => post({ message }),
    quick: (action: ChatSendAction) => post({ action }),
    decide,
    escalate,
    /** Mark a field-helper card locally (no server action: the value goes into the form). */
    markLocal: (msg: ChatMessageDTO, status: 'applied' | 'rejected') => setProposalStatus(msg.proposal?.id ?? null, msg.proposal?.key ?? '', status),
  }
}

export type SurveyChat = ReturnType<typeof useSurveyChat>

/** The wizard value of a card envelope (marks «не знаю» / «примерно» kept). */
export function wizardValueOf(envelope: Record<string, unknown>): unknown {
  return fromAnswerEnvelope(envelope)
}

/**
 * The field «Помощник» (spec §8.10): the same conversation, about one field.
 * «Записать» puts the value into the form (`onApply`) — the form saves it with
 * its own autosave on the path «helper»; the database is not written here.
 */
export function useFieldHelper(key: string | null, onApply: (key: string, value: unknown) => void, transport?: ChatTransport) {
  const chat = useSurveyChat({ focusKey: key, transport, autoload: false })
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!key || opened.current === key) return
    opened.current = key
    void chat.quick('next')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const accept = (msg: ChatMessageDTO, value?: unknown) => {
    const p = msg.proposal
    if (!p) return
    onApply(p.key, value !== undefined ? value : wizardValueOf(p.envelope))
    chat.markLocal(msg, 'applied')
  }
  return { ...chat, accept, messages: chat.messages.filter((m) => !key || m.key === key || m.kind === 'intro' || m.kind === 'escalated') }
}
