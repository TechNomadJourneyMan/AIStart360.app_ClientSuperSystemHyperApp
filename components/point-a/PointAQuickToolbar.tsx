'use client'

import { useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { POINT_A_OVERVIEW_QUERY_KEY, recalcErrorMessage } from '@/hooks/usePointAOverview'
import { useHrefVisible } from '@/hooks/usePlatformSections'
import { DocumentUploadDialog } from '@/components/documents/DocumentUploadDialog'
import { CLIENT_DOCUMENT_ACCEPT } from '@/lib/documents/client-upload'

/**
 * PointAQuickToolbar — sticky multifunction action bar at the top of Точка А.
 *
 * Quick actions (left → right, horizontally scrollable on mobile):
 *   • Загрузить файл  — opens file picker, then a dialog where the user picks
 *                       the document type; upload contract of
 *                       lib/documents/client-upload.ts (private bucket +
 *                       POST /api/v1/documents, processing starts on its own).
 *   • Заполнить анкету — link to onboarding wizard
 *   • Документы       — link to documents page
 *   • Точка Б         — link to target state
 *   • Метрики         — link to metrics catalog
 *   • Пересчитать     — POST /api/v1/diagnostics/recalculate then router.refresh()
 *
 * Premium glassmorphism aesthetic — matches existing dashboard tokens.
 */
export default function PointAQuickToolbar({ userId }: { userId: string | null }) {
  const documentsOn = useHrefVisible('/client/onboarding/documents')
  const pointBOn = useHrefVisible('/point-b')
  const metricsOn = useHrefVisible('/metrics')
  const router = useRouter()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [recalcState, setRecalcState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')

  // ─── File upload — shared dialog (explicit document type, live status) ──
  const onUploaded = useCallback(() => {
    // Refresh server data and the overview so the new document appears.
    void queryClient.invalidateQueries({ queryKey: POINT_A_OVERVIEW_QUERY_KEY })
    router.refresh()
  }, [queryClient, router])

  const openPicker = () => fileInputRef.current?.click()

  // ─── Recalculate ────────────────────────────────────────────────────────
  const recalculate = useCallback(async () => {
    setRecalcState('pending')
    try {
      const res = await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(recalcErrorMessage(res.status))
      setRecalcState('success')
      // The executive overview is client-side (React Query) — refresh it too.
      void queryClient.invalidateQueries({ queryKey: POINT_A_OVERVIEW_QUERY_KEY })
      router.refresh()
      setTimeout(() => setRecalcState('idle'), 2500)
    } catch {
      setRecalcState('error')
      setTimeout(() => setRecalcState('idle'), 3500)
    }
  }, [router, queryClient])

  // ─── Render ─────────────────────────────────────────────────────────────
  const recalcLabel =
    recalcState === 'pending' ? 'Считаем…' :
    recalcState === 'success' ? 'Готово' :
    recalcState === 'error' ? 'Ошибка' :
    'Пересчитать'

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-3 mb-2 bg-surface/80 backdrop-blur-xl border-b border-white/[0.04]">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-thin scrollbar-thumb-white/10"
           role="toolbar" aria-label="Быстрые действия">

        {/* Primary CTA — file upload */}
        <button
          type="button"
          onClick={openPicker}
          disabled={!userId}
          aria-label="Загрузить файл"
          title={userId ? undefined : 'Войдите в систему, чтобы загрузить документ'}
          className="group flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wide transition-all border bg-gradient-to-r from-primary to-[#00e29e] border-primary/40 text-[#003824] hover:shadow-[0_0_20px_rgba(110,255,192,0.35)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>upload_file</span>
          <span className="whitespace-nowrap">Загрузить файл</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept={CLIENT_DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setPickedFile(f)
            e.target.value = ''
          }}
        />
        <DocumentUploadDialog
          file={pickedFile}
          onClose={() => setPickedFile(null)}
          documentsHref="/point-a#files"
          onUploaded={onUploaded}
        />

        {/* Divider */}
        <div className="flex-shrink-0 h-6 w-px bg-white/[0.08] mx-1" />

        {/* Quick links — only sections switched on in GIGA-CRM */}
        <ToolbarLink href="/client/onboarding" icon="edit_note" label="Анкета" />
        {documentsOn && <ToolbarLink href="/client/onboarding/documents" icon="folder_open" label="Документы" />}
        {pointBOn && <ToolbarLink href="/point-b" icon="flag" label="Точка Б" />}
        {metricsOn && <ToolbarLink href="/metrics" icon="bar_chart" label="Метрики" />}

        {/* Divider */}
        <div className="flex-shrink-0 h-6 w-px bg-white/[0.08] mx-1" />

        {/* Recalculate */}
        <button
          type="button"
          onClick={recalculate}
          disabled={recalcState === 'pending'}
          aria-label={recalcLabel}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-mono text-xs uppercase tracking-wide transition-all border ${
            recalcState === 'success'
              ? 'bg-primary/15 border-primary/40 text-primary'
              : recalcState === 'error'
              ? 'bg-error/10 border-error/30 text-error'
              : 'bg-surface-container-low border-white/[0.06] text-on-surface hover:border-primary/30 hover:text-primary disabled:opacity-60'
          }`}
        >
          <span className={`material-symbols-outlined text-base ${recalcState === 'pending' ? 'animate-spin' : ''}`}>
            {recalcState === 'pending' ? 'progress_activity' :
             recalcState === 'success' ? 'check_circle' :
             recalcState === 'error' ? 'error' : 'refresh'}
          </span>
          <span className="whitespace-nowrap hidden sm:inline">{recalcLabel}</span>
        </button>

        {/* Spacer pushes status hint to the right on desktop */}
        <div className="flex-1 hidden md:block" />

        <span className="hidden lg:inline text-[10px] font-mono text-on-surface-variant/60 whitespace-nowrap pr-1">
          {userId ? 'данные синхронизированы' : 'не авторизован'}
        </span>
      </div>
    </div>
  )
}

function ToolbarLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-mono text-xs uppercase tracking-wide border border-white/[0.06] bg-surface-container-low text-on-surface hover:text-primary hover:border-primary/30 transition-all"
    >
      <span className="material-symbols-outlined text-base">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  )
}
