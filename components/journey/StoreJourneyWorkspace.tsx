'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { journeyStateSchema, type JourneyState, type JourneyWidget } from '@/lib/journey/schema'
import { storeHref } from '@/lib/store/links'
import { JourneyCanvas, JourneyMobileBoard } from './JourneyCanvas'
import { WidgetRenderer } from './widgets/WidgetRenderer'

const buttonClass = 'rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40'
const inputClass = 'mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40'

/** Dedicated authenticated Store surface: no guest identity, storage or demo fallback. */
export function StoreJourneyWorkspace({ initialState, companyId }: { initialState: JourneyState; companyId: string }) {
  const [state, setState] = useState<JourneyState | null>(initialState)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Загружаем сохранённый путь…')
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [goal, setGoal] = useState({ metric: '', target: '', deadline: '' })
  const endpoint = storeHref('/api/v1/journey/store', companyId)
  const latestGoal = state?.goals.at(-1)
  const pending = latestGoal?.status === 'draft' ? latestGoal : undefined
  const canConfirm = Boolean(pending?.metric && /\d/.test(pending.target ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(pending.deadline ?? ''))

  const readResponse = useCallback(async (response: Response) => {
    let data
    try { data = await response.json() } catch { throw new Error('Сервис магазина временно не ответил. Повторите действие позже.') }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { setState(null); setReady(false) }
      throw new Error(data?.error?.message ?? 'Не удалось сохранить путь магазина.')
    }
    return journeyStateSchema.parse(data.state)
  }, [])

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await readResponse(await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal }))
    setState(next)
    dirtyRef.current = false
    setDirty(false)
    setReady(true)
    setStatus(next.serverRevision ? 'Опубликованные факты обновлены · сохранённый путь загружен с сервера' : 'Опубликованные факты обновлены. Задайте и сохраните цель магазина.')
  }, [endpoint, readResponse])

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal).catch((cause) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сохранённый путь.')
      setStatus('Сохранение пока недоступно. Можно просмотреть опубликованные факты.')
    })
    return () => controller.abort()
  }, [reload])

  const mutate = async (payload: Record<string, unknown>, chat = false) => {
    if (!state || !ready || busy) return
    setBusy(true)
    setStatus(payload.action === 'confirm-goal' ? 'Подтверждаем цель и готовим план…' : chat ? 'Готовим ответ AI…' : 'Сохраняем изменения…')
    setError('')
    try {
      const response = await fetch(chat ? storeHref('/api/v1/journey/store/chat', companyId) : endpoint, {
        method: chat ? 'POST' : 'PATCH', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, revision: state.serverRevision ?? 0 }),
      })
      if (response.status === 409) {
        await reload()
        throw new Error('На другом устройстве появилась новая версия. Доска обновлена; повторите действие.')
      }
      const next = await readResponse(response)
      if (payload.action === 'layout') { dirtyRef.current = false; setDirty(false) }
      // A goal/chat save must not discard an unsaved local arrangement.
      setState(dirtyRef.current ? { ...next, widgets: next.widgets.map((widget) => {
        const local = state.widgets.find((entry) => entry.id === widget.id)
        return local ? { ...widget, position: local.position, hidden: local.hidden, collapsed: local.collapsed, focused: local.focused } : widget
      }) } : next)
      setStatus('Изменения сохранены на сервере')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.')
      setStatus('Не удалось завершить действие. Проверьте сообщение и повторите его.')
    } finally { setBusy(false) }
  }

  const changeWidgets = (change: (widget: JourneyWidget) => JourneyWidget) => {
    if (!ready || busy) return
    setState((current) => current ? { ...current, widgets: current.widgets.map(change) } : current)
    dirtyRef.current = true
    setDirty(true)
  }
  const updateWidget = (id: string, patch: Partial<Pick<JourneyWidget, 'position' | 'hidden' | 'collapsed' | 'focused'>>) => {
    changeWidgets((widget) => widget.id === id ? { ...widget, ...patch } : widget)
  }
  const draftGoal = (event: FormEvent) => { event.preventDefault(); void mutate({ action: 'draft-goal', goal }) }
  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (prompt.trim()) void mutate({ message: prompt.trim() }, true)
  }

  return (
    <main className="mx-auto max-w-[1800px] px-3 py-4 text-on-surface">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{state?.companyName || 'Магазин'} · Путь A → B</h1>
          <p className="mt-1 text-xs text-on-surface-variant">Точка A — опубликованные факты магазина. Цель и путь хранятся отдельно от обычного Journey.</p>
          <p className="mt-1 text-xs text-on-surface-variant">На другом устройстве войдите в тот же аккаунт и откройте эту компанию — сохранённые цель, план и раскладка будут доступны.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={buttonClass} href={storeHref('/store', companyId)}>Магазин</Link>
          <Link className={buttonClass} href={storeHref('/store/imports', companyId)}>Импорт данных</Link>
          <button type="button" className={buttonClass} disabled={busy || dirty} onClick={() => { setError(''); void reload().catch((cause) => setError(cause.message)) }}>Обновить факты</button>
          <button type="button" className={buttonClass} disabled={!ready || busy || !dirty} onClick={() => state && void mutate({ action: 'layout', layout: state.widgets.map(({ id, collapsed, hidden, focused, position }) => ({ id, collapsed, hidden, focused, position })) })}>Сохранить раскладку</button>
        </div>
      </header>
      <p role="status" className="mb-2 text-xs text-on-surface-variant">{!busy && dirty ? 'Раскладка изменена. Нажмите «Сохранить раскладку».' : status}</p>
      {error && <p role="alert" className="mb-3 rounded-xl border border-error/30 p-3 text-sm text-error">{error}</p>}
      {state && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className={`h-[760px] overflow-hidden rounded-2xl border border-white/10 ${busy ? 'pointer-events-none' : ''}`} aria-busy={busy}>
              <JourneyCanvas
                state={state}
                onWidgetToggle={(id) => { const widget = state.widgets.find((entry) => entry.id === id); if (widget) updateWidget(id, { collapsed: !widget.collapsed }) }}
                onWidgetFocus={(id) => changeWidgets((widget) => ({ ...widget, focused: widget.id === id, ...(widget.id === id ? { hidden: false, collapsed: false } : {}) }))}
                onWidgetHide={(id) => updateWidget(id, { hidden: true, focused: false })}
                onWidgetRestore={(id) => updateWidget(id, { hidden: false })}
                onWidgetMove={(id, position) => updateWidget(id, { position })}
                onWidgetResetLayout={() => changeWidgets((widget) => ({ ...widget, position: initialState.widgets.find((entry) => entry.id === widget.id)?.position ?? {
                  x: widget.kind === 'point_b_goals' ? 100 : widget.kind === 'roadmap_actions' ? 430 : 760, y: 860,
                }, hidden: false, collapsed: widget.id.startsWith('widget:store:plan:'), focused: false }))}
                onWidgetDiscuss={(widget) => setPrompt(`Разберём модуль «${widget.title}» на опубликованных данных магазина.`)}
                onSuggestionAccept={(suggestion) => setPrompt(suggestion.value)}
                onSuggestionReject={() => {}}
                onSuggestionHide={() => {}}
              />
              <JourneyMobileBoard state={state} />
            </div>
            <div className="mt-3 space-y-3 md:hidden">
              {state.widgets.some((widget) => widget.hidden) && <button type="button" className={buttonClass} disabled={!ready || busy} onClick={() => changeWidgets((widget) => ({ ...widget, hidden: false }))}>Показать скрытые модули</button>}
              {state.widgets.filter((widget) => !widget.hidden).map((widget) => (
                <details key={widget.id} className="rounded-xl border border-white/10 bg-surface-container-low p-3" open={!widget.collapsed} onToggle={(event) => {
                  if (event.currentTarget.open !== !widget.collapsed) updateWidget(widget.id, { collapsed: !event.currentTarget.open })
                }}>
                  <summary className="cursor-pointer text-sm font-medium">{widget.title}</summary>
                  <div className="mt-3"><WidgetRenderer widget={widget} /></div>
                </details>
              ))}
            </div>
          </div>
          <aside className="space-y-4" aria-label="Цель и диалог магазина">
            <section className="rounded-2xl border border-white/10 bg-surface-container-low p-4">
              <h2 className="font-medium">Точка B · измеримая цель</h2>
              <form onSubmit={draftGoal} className="mt-3 space-y-3">
                <fieldset disabled={!ready || busy} className="space-y-3">
                  <label className="block text-xs">Показатель<input className={inputClass} required maxLength={160} value={goal.metric} onChange={(event) => setGoal({ ...goal, metric: event.target.value })} placeholder="Например, валовая маржа" /></label>
                  <label className="block text-xs">Целевое значение<input className={inputClass} required maxLength={160} value={goal.target} onChange={(event) => setGoal({ ...goal, target: event.target.value })} placeholder="Например, 35%" /></label>
                  <label className="block text-xs">Срок<input className={inputClass} required type="date" value={goal.deadline} onChange={(event) => setGoal({ ...goal, deadline: event.target.value })} /></label>
                  <button type="submit" className={buttonClass}>Подготовить цель</button>
                </fieldset>
              </form>
              {pending && (
                <div className="mt-4 rounded-xl border border-primary/30 p-3">
                  <p className="text-xs text-primary">Черновик · проверьте перед подтверждением</p>
                  <p className="my-2 text-sm">{pending.title}</p>
                  <p className="mb-3 text-xs text-on-surface-variant">{[pending.metric, pending.target, pending.deadline].filter(Boolean).join(' · ')}</p>
                  {!canConfirm && <p className="mb-3 text-xs text-on-surface-variant">Уточните числовую цель и точную дату через форму выше.</p>}
                  <button type="button" className={buttonClass} disabled={!ready || busy || !canConfirm} onClick={() => void mutate({ action: 'confirm-goal', goalId: pending.id })}>Подтвердить эту Точку B</button>
                </div>
              )}
            </section>
            {state.roadmap.some((item) => !item.id.startsWith('roadmap:store:')) && (
              <section className="rounded-2xl border border-white/10 bg-surface-container-low p-4">
                <h2 className="font-medium">Шаги к цели</h2>
                <p className="mt-1 text-xs text-on-surface-variant">Отмечайте только фактически выполненные действия. Отметки сохраняются на сервере.</p>
                <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                  {state.roadmap.filter((item) => !item.id.startsWith('roadmap:store:')).map((item) => <li key={item.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={item.status === 'done'} disabled={!ready || busy} className="mt-1 accent-primary" onChange={(event) => void mutate({ action: 'roadmap-status', itemId: item.id, done: event.target.checked })} />
                      <span><span className={item.status === 'done' ? 'line-through text-on-surface-variant' : ''}>{item.title}</span><span className="mt-1 block text-xs text-on-surface-variant">{item.description}</span><span className="mt-1 block text-xs text-on-surface-variant">{item.horizon}</span></span>
                    </label>
                  </li>)}
                </ul>
              </section>
            )}
            <section className="rounded-2xl border border-white/10 bg-surface-container-low p-4">
              <h2 className="font-medium">Разобрать путь с AI</h2>
              <p className="mt-1 text-xs text-on-surface-variant">{state.provider.label}. AI может предложить черновик цели; подтверждение остаётся за вами.</p>
              <Link href={storeHref('/store/imports', companyId)} className="mt-2 inline-block rounded-lg text-xs text-primary underline focus:outline-none focus:ring-2 focus:ring-primary/40">Загрузить данные магазина через защищённый импорт</Link>
              <div className="my-3 max-h-72 space-y-3 overflow-y-auto" aria-label="История диалога">
                {state.messages.map((message) => <p key={message.id} className="whitespace-pre-wrap text-xs leading-relaxed"><strong>{message.role === 'user' ? 'Вы' : 'Помощник'}: </strong>{message.text}</p>)}
              </div>
              <form onSubmit={sendMessage}>
                <label className="block text-xs">Сообщение<textarea className={inputClass} rows={3} maxLength={4000} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!ready || busy || state.provider.mode !== 'live'} /></label>
                <button type="submit" className={`${buttonClass} mt-2`} disabled={!ready || busy || !prompt.trim() || state.provider.mode !== 'live'}>Отправить</button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </main>
  )
}
