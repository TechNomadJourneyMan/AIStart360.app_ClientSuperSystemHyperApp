'use client'

/**
 * components/point-a/v2/MarketGenerateButton.tsx — one-click market analysis.
 *
 * Closes the dashboard↔/market gap: the dashboard card reads the per-user
 * market_snapshots row, which only appears after POST
 * /api/v1/market-analysis/generate (AI drafts the 50-question checklist and
 * rebuilds the snapshot). Without this button a fresh user saw an eternal
 * «Нет данных» while the /market section (the shared Mark-analytics map)
 * looked alive. Generation takes up to ~a minute — honest progress copy,
 * router.refresh() re-renders the server card with real tiles when done.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function MarketGenerateButton() {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)

  const run = async () => {
    if (state === 'running') return
    setState('running')
    setErrorText(null)
    try {
      const res = await fetch('/api/v1/market-analysis/generate', {
        method: 'POST',
        credentials: 'include',
      })
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null
      if (res.ok && json?.ok) {
        router.refresh()
        return
      }
      setState('error')
      setErrorText(
        json?.error === 'ai_not_configured'
          ? 'AI-провайдер не настроен — обратитесь к администратору.'
          : 'Не получилось сформировать анализ. Попробуйте ещё раз через минуту.',
      )
    } catch {
      setState('error')
      setErrorText('Ошибка сети — попробуйте ещё раз.')
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={run}
        disabled={state === 'running'}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-[#003824] font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span
          className={`material-symbols-outlined text-base ${state === 'running' ? 'animate-spin' : ''}`}
        >
          {state === 'running' ? 'progress_activity' : 'auto_awesome'}
        </span>
        {state === 'running' ? 'Формирую анализ… ~1 мин' : 'Сформировать анализ'}
      </button>
      {state === 'running' && (
        <p className="text-[11px] text-on-surface-variant mt-2">
          AI-агенты заполняют чек-лист из 50 параметров по вашей анкете и данным рынка.
        </p>
      )}
      {errorText && <p className="text-[11px] text-error mt-2">{errorText}</p>}
    </div>
  )
}
