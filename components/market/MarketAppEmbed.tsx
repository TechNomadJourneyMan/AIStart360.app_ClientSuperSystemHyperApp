'use client'

/**
 * MarketAppEmbed — встраивает продукт «Рынок» (Mark-analytics SPA, Vite+React)
 * в личный кабинет портала. Решение зафиксировано с владельцем продукта:
 * SPA встраивается «как есть» (1:1 с её собственным UI), вход — только через
 * кабинет, старый радар /market удалён.
 *
 * Auth-мост: после загрузки iframe передаём текущую Supabase-сессию кабинета
 * через postMessage (тот же Supabase-проект), чтобы пользователю не пришлось
 * логиниться второй раз. SPA слушает сообщение типа `aistart360:session`
 * (см. Mark-analytics/frontend/src/main.tsx) и вызывает auth.setSession().
 *
 * Честные состояния: если SPA недоступна (не запущена / URL не задан) —
 * показываем карточку с инструкцией, никаких заглушек.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const APP_URL = process.env.NEXT_PUBLIC_MARKET_APP_URL || 'http://localhost:5173'

type Status = 'checking' | 'up' | 'down'

export default function MarketAppEmbed() {
  const [status, setStatus] = useState<Status>('checking')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

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

  useEffect(() => {
    void probe()
  }, [probe])

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
    <div className="space-y-3">
      {/* Шапка раздела + переход к чек-листу 50 вопросов */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <Link
          href="/market/analysis"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-bold text-sm hover:brightness-110 transition-all"
          style={{
            background: 'linear-gradient(90deg, #e87a35, #dc524b)',
            boxShadow: '0 0 20px -8px rgba(232,122,53,0.55)',
          }}
        >
          <span className="material-symbols-outlined text-base">checklist</span>
          Чек-лист 50 вопросов
        </Link>
      </div>

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

      {status === 'up' && (
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden bg-[#0a0c12]">
          <iframe
            ref={iframeRef}
            src={APP_URL}
            onLoad={handleLoad}
            title="Рынок · Mark-analytics"
            className="w-full border-0"
            style={{ height: 'calc(100vh - 180px)', minHeight: 640 }}
            allow="fullscreen"
          />
        </div>
      )}
    </div>
  )
}
