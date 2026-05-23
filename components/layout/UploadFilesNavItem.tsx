'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface Props {
  collapsed: boolean
}

interface Status {
  documents: {
    count: number
    has_files: boolean
  }
}

const TARGET_HREF = '/client/onboarding/documents'
const TIP_KEY = 'upload_tip_shown'

/**
 * UploadFilesNavItem — desktop sidebar item «Загрузить файлы».
 *
 *  • Always rendered, matches existing nav item styling
 *  • When no documents are uploaded → glowing teal halo + amber pulse dot
 *    + auto-tooltip (once per session) prompting the user to upload
 *  • When documents exist → calm look + tiny mono count badge
 */
export function UploadFilesNavItem({ collapsed }: Props) {
  const pathname = usePathname()
  const [status, setStatus] = useState<Status | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [autoTipVisible, setAutoTipVisible] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Fetch status on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/onboarding/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j?.ok) setStatus(j.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-show tooltip for 3s on first mount of the session if docs missing
  useEffect(() => {
    if (!loaded || !status) return
    if (status.documents.has_files) return
    if (typeof window === 'undefined') return
    try {
      if (window.sessionStorage.getItem(TIP_KEY) === '1') return
      window.sessionStorage.setItem(TIP_KEY, '1')
    } catch {
      // ignore
    }
    setAutoTipVisible(true)
    const t = window.setTimeout(() => setAutoTipVisible(false), 3000)
    return () => window.clearTimeout(t)
  }, [loaded, status])

  const hasDocs = status?.documents.has_files ?? true
  const docCount = status?.documents.count ?? 0
  const active = pathname.startsWith(TARGET_HREF)
  const tooltipOpen = hovering || autoTipVisible

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link
        href={TARGET_HREF}
        title={collapsed ? 'Загрузить файлы' : undefined}
        aria-label="Загрузить файлы"
        className={`
          group flex items-center rounded-xl transition-all duration-200 relative
          ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}
          ${active
            ? 'bg-primary/10 text-primary'
            : !hasDocs && loaded
              ? 'bg-primary/[0.08] text-primary hover:bg-primary/[0.14] shadow-[0_0_18px_rgba(110,255,192,0.35)] animate-pulse'
              : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
          }
        `}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
        )}

        <span
          className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-all duration-150
            ${active || (!hasDocs && loaded)
              ? 'text-primary'
              : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}
          `}
          style={active || (!hasDocs && loaded) ? { fontVariationSettings: "'FILL' 0.7, 'wght' 400" } : undefined}
        >
          cloud_upload
        </span>

        {!collapsed && (
          <span
            className={`text-sm truncate font-medium flex-1 ${
              active || (!hasDocs && loaded) ? 'text-primary' : ''
            }`}
          >
            Загрузить файлы
          </span>
        )}

        {/* Document count badge (calm state, only when expanded + docs exist) */}
        {!collapsed && hasDocs && loaded && docCount > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-md bg-primary/15 border border-primary/25 text-primary text-[10px] font-mono leading-none">
            {docCount}
          </span>
        )}

        {/* Amber pulse dot (no-docs state) */}
        {loaded && !hasDocs && (
          <span className="absolute -top-1 -right-1 flex w-2.5 h-2.5 pointer-events-none">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
          </span>
        )}
      </Link>

      {/* Tooltip / popover */}
      {tooltipOpen && loaded && (
        <div
          className={`
            absolute z-[60] left-full top-0 ml-3 w-[280px]
            rounded-2xl bg-surface-container-high border border-white/10
            shadow-modal p-3.5
            animate-slide-in-right
          `}
          role="tooltip"
        >
          {/* Pointer */}
          <span className="absolute -left-1.5 top-3 w-3 h-3 rotate-45 bg-surface-container-high border-l border-b border-white/10" />

          {!hasDocs ? (
            <>
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
                AI ждёт ваши данные
              </p>
              <p className="text-[13px] text-on-surface leading-relaxed mb-3">
                Загрузите файлы (P&amp;L, отчёты, выгрузка клиентов в xlsx/csv/pdf) — AI сформирует Точку А с реальными метриками.
              </p>
              <Link
                href={TARGET_HREF}
                className="inline-flex items-center gap-1.5 w-full justify-center px-3 py-2 rounded-xl bg-primary text-[#0A0B0F] text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                Загрузить сейчас
              </Link>
            </>
          ) : (
            <p className="text-[13px] text-on-surface leading-relaxed">
              Управлять документами · <span className="font-mono text-primary">{docCount}</span>{' '}
              {pluralize(docCount, ['файл', 'файла', 'файлов'])}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function pluralize(n: number, forms: [string, string, string]) {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
  return forms[2]
}
