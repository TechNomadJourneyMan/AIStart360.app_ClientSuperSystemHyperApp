'use client'

import { useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

/**
 * PointAQuickToolbar — sticky multifunction action bar at the top of Точка А.
 *
 * Quick actions (left → right, horizontally scrollable on mobile):
 *   • Загрузить файл  — opens file picker, uploads to Supabase Storage,
 *                       registers via /api/v1/onboarding/documents, triggers parse.
 *   • Заполнить анкету — link to onboarding wizard
 *   • Документы       — link to documents page
 *   • Точка Б         — link to target state
 *   • Метрики         — link to metrics catalog
 *   • Пересчитать     — POST /api/v1/diagnostics/recalculate then router.refresh()
 *
 * Premium glassmorphism aesthetic — matches existing dashboard tokens.
 */
export default function PointAQuickToolbar({ userId }: { userId: string | null }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [recalcState, setRecalcState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')

  // ─── File upload — same flow as components/point-a/FileArea.tsx ─────────
  const handleFile = useCallback(async (file: File) => {
    if (!userId) {
      setUploadState('error')
      return
    }
    setUploadState('uploading')
    setUploadName(file.name)
    try {
      const sb = createClient()
      const ext = file.name.split('.').pop() || 'bin'
      const storagePath = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await sb.storage
        .from('user-documents')
        .upload(storagePath, file, { cacheControl: '3600', upsert: false })
      if (upErr) throw new Error(upErr.message)
      const { data: pub } = sb.storage.from('user-documents').getPublicUrl(storagePath)
      const res = await fetch('/api/v1/onboarding/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          user_id: userId,
          file_name: file.name,
          file_url: pub.publicUrl,
          file_size: file.size,
          mime_type: file.type,
          storage_path: storagePath,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setUploadState('success')
      // Refresh server data so the new document appears
      router.refresh()
      setTimeout(() => setUploadState('idle'), 2500)
    } catch (e) {
      console.error('[quick-toolbar] upload failed', e)
      setUploadState('error')
      setTimeout(() => setUploadState('idle'), 3500)
    }
  }, [userId, router])

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
      if (!res.ok) throw new Error('recalc failed')
      setRecalcState('success')
      router.refresh()
      setTimeout(() => setRecalcState('idle'), 2500)
    } catch {
      setRecalcState('error')
      setTimeout(() => setRecalcState('idle'), 3500)
    }
  }, [router])

  // ─── Render ─────────────────────────────────────────────────────────────
  const uploadLabel =
    uploadState === 'uploading' ? 'Загружаем…' :
    uploadState === 'success' ? 'Загружено' :
    uploadState === 'error' ? 'Ошибка' :
    'Загрузить файл'

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
          disabled={uploadState === 'uploading' || !userId}
          aria-label={uploadLabel}
          className={`group flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wide transition-all border ${
            uploadState === 'success'
              ? 'bg-primary/20 border-primary/50 text-primary'
              : uploadState === 'error'
              ? 'bg-error/15 border-error/40 text-error'
              : 'bg-gradient-to-r from-primary to-[#00e29e] border-primary/40 text-[#003824] hover:shadow-[0_0_20px_rgba(110,255,192,0.35)] disabled:opacity-60'
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {uploadState === 'uploading'
              ? 'progress_activity'
              : uploadState === 'success'
              ? 'check_circle'
              : uploadState === 'error'
              ? 'error'
              : 'upload_file'}
          </span>
          <span className="whitespace-nowrap">{uploadLabel}</span>
          {uploadState !== 'idle' && uploadName && (
            <span className="hidden sm:inline text-[10px] font-normal text-current/70 truncate max-w-[160px]">
              · {uploadName}
            </span>
          )}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,.docx,.doc"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />

        {/* Divider */}
        <div className="flex-shrink-0 h-6 w-px bg-white/[0.08] mx-1" />

        {/* Quick links */}
        <ToolbarLink href="/client/onboarding" icon="edit_note" label="Анкета" />
        <ToolbarLink href="/client/onboarding/documents" icon="folder_open" label="Документы" />
        <ToolbarLink href="/point-b" icon="flag" label="Точка Б" />
        <ToolbarLink href="/metrics" icon="bar_chart" label="Метрики" />

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
