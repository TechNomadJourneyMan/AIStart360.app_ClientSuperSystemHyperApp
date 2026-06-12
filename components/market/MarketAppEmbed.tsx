'use client'

/**
 * MarketAppEmbed — раздел «Рынок» личного кабинета с объединённой навигацией.
 *
 * Решение зафиксировано с владельцем продукта: продукт Mark-analytics (Vite+React
 * SPA) встраивается в кабинет, вход — только через кабинет. Навигация объединена:
 * портальные табы поверх встроенной SPA (SPA в embed-режиме прячет свою шапку/логин).
 *
 * Три таба:
 *   • «Карта»        — iframe `${APP_URL}/?embed=1`
 *   • «Анализ ниши»  — iframe `${APP_URL}/competitors?embed=1`
 *   • «Чек-лист 50»  — рендерит <MarketAnalysisChecklist/> инлайн (без перехода).
 *
 * Состояние таба синхронизировано с ?tab= (router.replace, без скролла). Дип-линк
 * /market/analysis открывает тот же чек-лист (см. app/(dashboard)/market/analysis).
 *
 * Auth-мост: после загрузки iframe передаём текущую Supabase-сессию кабинета
 * через postMessage (тот же Supabase-проект). SPA слушает `aistart360:session`.
 *
 * Честные состояния: probe доступности — только для iframe-табов; если SPA
 * недоступна, показываем карточку с инструкцией, без заглушек.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MarketAnalysisChecklist } from '@/components/market-analysis/MarketAnalysisChecklist'

const APP_URL = process.env.NEXT_PUBLIC_MARKET_APP_URL || 'http://localhost:5173'

type Status = 'checking' | 'up' | 'down'

type TabId = 'map' | 'niche' | 'checklist'

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'map', label: 'Карта', icon: 'public' },
  { id: 'niche', label: 'Анализ ниши', icon: 'donut_large' },
  { id: 'checklist', label: 'Чек-лист 50', icon: 'checklist' },
]

const IFRAME_SRC: Record<'map' | 'niche', string> = {
  map: `${APP_URL}/?embed=1`,
  niche: `${APP_URL}/competitors?embed=1`,
}

function isTabId(v: string | null): v is TabId {
  return v === 'map' || v === 'niche' || v === 'checklist'
}

export default function MarketAppEmbed() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Single source of truth: the URL. No local tab state → no resync races
  // (a useState + "sync from URL" effect could fight router.replace and
  // bounce the active tab back).
  const rawTab = searchParams.get('tab')
  const tab: TabId = isTabId(rawTab) ? rawTab : 'map'

  const [status, setStatus] = useState<Status>('checking')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const selectTab = useCallback(
    (next: TabId) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      params.set('tab', next)
      router.replace(`/market?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const isIframeTab = tab === 'map' || tab === 'niche'

  const probe = useCallback(async () => {
    setStatus('checking')
    try {
      // no-cors: resolve (opaque) = сервер отвечает; network error = недоступен.
      await fetch(APP_URL, { mode: 'no-cors', signal: AbortSignal.timeout(4000) })
      setStatus('up')
    } catch {
      setStatus('down')
    }
  }, [])

  // Probe availability only for iframe tabs.
  useEffect(() => {
    if (isIframeTab) void probe()
  }, [isIframeTab, probe])

  // Auth-мост: после загрузки iframe отправляем сессию кабинета.
  const handleLoad = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      const s = data.session
      if (!s || !iframeRef.current?.contentWindow) return
      const targetOrigin = new URL(APP_URL).origin
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'aistart360:session',
          access_token: s.access_token,
          refresh_token: s.refresh_token,
        },
        targetOrigin,
      )
    } catch {
      // Сессии нет или мост не сработал — SPA покажет собственную кнопку «Войти».
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Шапка раздела */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-xl text-primary">public</span>
        </div>
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
            Рынок · Mark-analytics
          </p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface leading-tight">
            Карта рынка и анализ конкурентов
          </h1>
        </div>
      </div>

      {/* Объединённая навигация: портальные табы поверх встроенной SPA */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:border-white/[0.12]'
              }`}
            >
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Контент таба */}
      {tab === 'checklist' ? (
        <MarketAnalysisChecklist />
      ) : (
        <>
          {status === 'checking' && (
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-16 flex items-center justify-center">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
            </div>
          )}

          {status === 'down' && (
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant/60 block mb-3">
                cloud_off
              </span>
              <p className="text-sm font-bold text-on-surface">Продукт «Рынок» сейчас недоступен</p>
              <p className="text-xs text-on-surface-variant mt-2 max-w-md mx-auto leading-relaxed">
                Приложение Mark-analytics не отвечает по адресу{' '}
                <span className="font-mono text-on-surface">{APP_URL}</span>. Запустите его
                (frontend: 5173, backend: 8000) или задайте переменную
                NEXT_PUBLIC_MARKET_APP_URL.
              </p>
              <button
                onClick={() => void probe()}
                className="mt-4 text-xs font-mono uppercase tracking-widest text-primary hover:brightness-110 transition-colors"
              >
                Проверить снова
              </button>
            </div>
          )}

          {status === 'up' && isIframeTab && (
            <div className="rounded-2xl border border-white/[0.06] overflow-hidden bg-[#0a0c12]">
              <iframe
                ref={iframeRef}
                key={tab}
                src={IFRAME_SRC[tab]}
                onLoad={handleLoad}
                title={tab === 'map' ? 'Карта рынка · Mark-analytics' : 'Анализ ниши · Mark-analytics'}
                className="w-full border-0"
                style={{ height: 'calc(100vh - 220px)', minHeight: 640 }}
                allow="fullscreen"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
