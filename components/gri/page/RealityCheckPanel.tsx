'use client'

// components/gri/page/RealityCheckPanel.tsx — «Reality Check — самооценка vs
// данные» (идея №30). Самодостаточная панель: сама грузит
// GET /api/v1/gri/reality-check и показывает детерминированные расхождения
// самооценки GRI с фактами анкеты/Точки А. Без LLM: каждая карточка цитирует
// конкретную цифру из данных, «нет данных → нет расхождения».
import { useEffect, useState } from 'react'
import { AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import type { RealityCheckItem } from '@/lib/gri/reality-check'

interface ApiResponse {
  ok: boolean
  items?: RealityCheckItem[]
  hasData?: boolean
}

export default function RealityCheckPanel() {
  const [items, setItems] = useState<RealityCheckItem[]>([])
  const [hasData, setHasData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/gri/reality-check', { credentials: 'include' })
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (!alive) return
        if (res?.ok) {
          setItems(Array.isArray(res.items) ? res.items : [])
          setHasData(!!res.hasData)
        }
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // Нет ассессмента / не залогинен / ошибка — панель молчит целиком.
  if (loading || !hasData) return null

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
        Reality Check — самооценка vs данные
      </p>
      <p className="mt-1 text-sm text-on-surface-variant">
        Детерминированная сверка вашей GRI-самооценки с анкетой и Точкой А.
      </p>

      {items.length === 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-sm text-on-surface">
            Расхождений не найдено — самооценка согласуется с вашими данными.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const mismatch = item.severity === 'mismatch'
            return (
              <li
                key={item.blockId}
                className={`flex items-start gap-3 rounded-xl border p-4 ${
                  mismatch
                    ? 'border-amber-400/25 bg-amber-400/[0.06]'
                    : 'border-white/[0.08] bg-white/[0.03]'
                }`}
              >
                {mismatch ? (
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                    aria-hidden
                  />
                ) : (
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant"
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        mismatch ? 'text-amber-300' : 'text-on-surface'
                      }`}
                    >
                      {item.blockLabelRu}
                    </span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] tabular-nums text-on-surface-variant">
                      самооценка {String(item.selfScore).replace('.', ',')}/10
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-on-surface-variant">
                    {item.finding}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-snug text-on-surface-variant/80">
        Проверка построена на ваших данных анкеты и Точки А, без ИИ-домыслов.
      </p>
    </section>
  )
}
