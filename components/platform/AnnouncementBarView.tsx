'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const TONES = {
  info: { box: 'border-sky-400/25 bg-sky-400/[0.08] text-sky-100', icon: 'campaign' },
  success: { box: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100', icon: 'celebration' },
  warning: { box: 'border-amber-400/30 bg-amber-400/[0.1] text-amber-100', icon: 'warning' },
} as const

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}

export default function AnnouncementBarView({ text, tone, linkLabel, linkHref, className }: {
  text: string
  tone: keyof typeof TONES
  linkLabel: string | null
  linkHref: string | null
  className?: string
}) {
  // A dismissed announcement stays hidden until its text changes.
  const key = `aistart360.announcement.${hash(text + (linkHref ?? ''))}`
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === '1') setHidden(true)
    } catch {
      /* storage unavailable */
    }
  }, [key])
  if (hidden) return null

  const t = TONES[tone] ?? TONES.info
  const external = !!linkHref && linkHref.startsWith('https://')
  return (
    <div role="status" data-testid="platform-announcement" className={`flex items-start gap-3 rounded-xl border px-4 py-2.5 text-sm ${t.box} ${className ?? ''}`}>
      <span className="material-symbols-outlined mt-0.5 text-[18px]" aria-hidden>{t.icon}</span>
      <p className="min-w-0 flex-1 leading-relaxed">
        {text}
        {linkHref && linkLabel && (
          external ? (
            <a href={linkHref} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold underline underline-offset-2">{linkLabel}</a>
          ) : (
            <Link href={linkHref} className="ml-2 font-semibold underline underline-offset-2">{linkLabel}</Link>
          )
        )}
      </p>
      <button
        type="button"
        aria-label="Скрыть объявление"
        onClick={() => {
          setHidden(true)
          try { localStorage.setItem(key, '1') } catch { /* ignore */ }
        }}
        className="rounded-md p-0.5 opacity-70 transition hover:opacity-100"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden>close</span>
      </button>
    </div>
  )
}
