'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUIStore } from '@/stores/ui.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useAuthStore } from '@/stores/auth.store'
import { hasPermission } from '@/lib/navigation'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types'
import { getClientLocale, setClientLocale, type Locale } from '@/lib/i18n/locale'

export function Header() {
  const { sidebarCollapsed } = useUIStore()
  const { unreadCount } = useNotificationsStore()
  const { user, logout } = useAuthStore()
  const router = useRouter()
  const [searchFocused, setSearchFocused] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showQuickAction, setShowQuickAction] = useState(false)
  const [locale, setLocale] = useState<Locale>('ru')
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [uploadMessage, setUploadMessage] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Hydrate the toggle from the persisted cookie. The cookie isn't available
  // during SSR, so we read it after mount to keep server/client markup in sync.
  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  // Persisted RU↔EN toggle. setClientLocale writes the cookie and reloads so
  // server route handlers (AI insights, new-module labels) pick up the change.
  const toggleLocale = () => setClientLocale(locale === 'ru' ? 'en' : 'ru')

  interface QuickAction {
    label: string
    icon: string
    href: string
    reqPermission?: string
  }
  interface QuickActionGroup {
    title: string
    items: QuickAction[]
  }

  const QUICK_ACTION_GROUPS: QuickActionGroup[] = [
    {
      title: 'Файлы',
      items: [
        { label: 'Загрузить файл', icon: 'upload_file', href: '#upload' },
        { label: 'Мои документы',  icon: 'folder_open', href: '/point-a#files' },
      ],
    },
    {
      title: 'Диагностика',
      items: [
        { label: 'Заполнить анкету',  icon: 'edit_note',  href: '/client/onboarding' },
        { label: 'GRI Assessment',    icon: 'radar',      href: '/gri' },
        { label: 'Точка А',           icon: 'my_location', href: '/point-a' },
      ],
    },
    {
      title: 'Аналитика',
      items: [
        { label: 'Метрики роста',  icon: 'monitoring',  href: '/metrics' },
        { label: 'Инсайты',        icon: 'lightbulb',   href: '/insights' },
        { label: 'Отчёты',         icon: 'description', href: '/reports' },
      ],
    },
    {
      title: 'Стратегия',
      items: [
        { label: 'Точка Б — цели роста', icon: 'flag', href: '/point-b' },
      ],
    },
    {
      title: 'Команда',
      items: [
        { label: 'Новый клиент',        icon: 'person_add', href: '/clients', reqPermission: 'clients.write' },
        { label: 'Управление командой', icon: 'groups',     href: '/team',    reqPermission: 'team.write'    },
      ],
    },
  ]

  const userRole = ((user?.role || 'client').toUpperCase()) as UserRole
  const visibleGroups = QUICK_ACTION_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((a) => !a.reqPermission || hasPermission(userRole, a.reqPermission)),
    }))
    .filter((g) => g.items.length > 0)

  const triggerFilePicker = () => {
    setShowQuickAction(false)
    setUploadStatus('idle')
    setUploadMessage('')
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!user?.id) {
      setUploadStatus('error')
      setUploadMessage('Нужно войти в аккаунт')
      return
    }
    try {
      setUploadStatus('uploading')
      setUploadMessage(`Загрузка ${file.name}…`)
      const sb = createClient()
      const storagePath = `${user.id}/${Date.now()}_${file.name}`
      const { error: uploadError } = await sb.storage
        .from('documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (uploadError) throw new Error(uploadError.message)
      const { data: { publicUrl } } = sb.storage.from('documents').getPublicUrl(storagePath)
      const res = await fetch('/api/v1/onboarding/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          file_name: file.name,
          file_url: publicUrl,
          file_size: file.size,
          mime_type: file.type,
          doc_type: 'financial_report',
        }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error ?? 'Ошибка загрузки')
      setUploadStatus('done')
      setUploadMessage(`✅ ${file.name} загружен`)
      window.setTimeout(() => {
        setUploadStatus('idle')
        setUploadMessage('')
      }, 3500)
    } catch (err) {
      setUploadStatus('error')
      setUploadMessage(err instanceof Error ? err.message : 'Ошибка загрузки')
      window.setTimeout(() => {
        setUploadStatus('idle')
        setUploadMessage('')
      }, 5000)
    }
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'AS'

  return (
    <header
      className={`
        fixed top-0 right-0 z-40 h-16
        bg-background/80 backdrop-blur-xl
        border-b border-outline-variant/10
        flex items-center justify-between px-4 md:px-6 lg:px-8
        transition-all duration-250
        ${sidebarCollapsed ? 'lg:left-[68px]' : 'lg:left-[220px]'}
        left-0
      `}
    >
      {/* Left: Search — role-aware destination */}
      <div className={`relative transition-all duration-200 ${searchFocused ? 'w-56 lg:w-72' : 'w-32 lg:w-44'}`}>
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[18px] pointer-events-none">
          search
        </span>
        <input
          type="search"
          placeholder={
            searchFocused
              ? (hasPermission(userRole, 'clients.read')
                  ? 'Поиск клиентов, отчётов...'
                  : 'Поиск метрик, документов...')
              : 'Поиск...'
          }
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const q = (e.target as HTMLInputElement).value.trim()
            if (!q) return
            const dest = hasPermission(userRole, 'clients.read')
              ? `/clients?q=${encodeURIComponent(q)}`
              : `/metrics?q=${encodeURIComponent(q)}`
            router.push(dest)
          }}
          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg pl-8 pr-7 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10 transition-all"
        />
        <kbd className="hidden lg:inline-flex absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-on-surface-variant/25 border border-outline-variant/20 rounded px-1 py-0.5">
          ↵
        </kbd>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Quick Action */}
        <div className="relative">
          <button
            onClick={() => setShowQuickAction(v => !v)}
            title="Быстрое действие"
            className={`inline-flex items-center gap-1.5 text-xs font-mono border px-2.5 py-2.5 min-h-[40px] rounded-lg transition-colors ${
              showQuickAction
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'text-primary border-primary/20 hover:bg-primary/5'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
            <span className="hidden lg:inline">Действие</span>
            <span className={`hidden md:inline material-symbols-outlined text-xs transition-transform duration-200 ${showQuickAction ? 'rotate-180' : ''}`}>expand_more</span>
          </button>

          {showQuickAction && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowQuickAction(false)} />
              <div className="absolute left-0 top-full mt-2 w-64 max-h-[80vh] overflow-y-auto bg-surface-container-low border border-white/[0.06] rounded-xl shadow-xl z-50 py-2">
                {visibleGroups.map((group, groupIdx) => (
                  <div key={group.title}>
                    {groupIdx > 0 && <div className="my-1.5 border-t border-white/[0.04]" />}
                    <div className="px-4 py-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-on-surface-variant/50">
                      {group.title}
                    </div>
                    {group.items.map((action) => {
                      if (action.href === '#upload') {
                        return (
                          <button
                            key={action.label}
                            type="button"
                            onClick={triggerFilePicker}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors text-left min-h-[40px]"
                          >
                            <span className="material-symbols-outlined text-base text-primary/60">{action.icon}</span>
                            {action.label}
                          </button>
                        )
                      }
                      return (
                        <Link key={action.href} href={action.href}
                          onClick={() => setShowQuickAction(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors min-h-[40px]">
                          <span className="material-symbols-outlined text-base text-primary/60">{action.icon}</span>
                          {action.label}
                        </Link>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.png,.jpg,.jpeg"
          onChange={handleFileSelected}
        />

        {uploadMessage && (
          <div
            className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border ${
              uploadStatus === 'uploading'
                ? 'bg-primary/5 border-primary/20 text-primary'
                : uploadStatus === 'done'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-error/10 border-error/30 text-error'
            }`}
          >
            {uploadStatus === 'uploading' && (
              <span className="material-symbols-outlined text-sm animate-pulse">cloud_upload</span>
            )}
            <span className="truncate max-w-[220px]">{uploadMessage}</span>
          </div>
        )}

        {/* Отчёты — открывает клиентский отчёт (Точка А + цели + данные анкеты) */}
        <Link href="/client/point-a"
          title="Отчёт по Точке А — индекс готовности к росту, цели, данные анкеты и документы"
          className="hidden lg:inline-flex items-center gap-1.5 text-xs font-semibold bg-gradient-to-br from-primary to-primary-container text-on-primary px-3.5 py-2.5 min-h-[40px] rounded-lg hover:scale-[0.97] active:scale-95 transition-all duration-150">
          <span className="material-symbols-outlined text-[18px]">description</span>
          Отчёты
        </Link>

        <div className="w-px h-6 bg-outline-variant/20 hidden md:block" />

        {/* Real-time clock — isolated so its 1s tick doesn't re-render the
            whole 380-line Header (menus, quick-actions, upload status). */}
        <HeaderClock />

        {/* Language switcher — persisted RU↔EN, drives AI insights + module labels */}
        <button
          onClick={toggleLocale}
          title={`Язык: ${locale.toUpperCase()} → переключить на ${(locale === 'ru' ? 'en' : 'ru').toUpperCase()}`}
          aria-label={`Сменить язык, текущий: ${locale.toUpperCase()}`}
          className="flex items-center gap-1 px-2.5 py-2.5 min-h-[40px] min-w-[40px] justify-center rounded-lg border border-outline-variant/20 text-xs font-mono text-on-surface-variant hover:text-on-surface hover:border-primary/20 hover:bg-primary/5 transition-all duration-150"
        >
          <span className="material-symbols-outlined text-sm hidden md:inline">translate</span>
          <span>{locale.toUpperCase()}</span>
        </button>

        <div className="w-px h-6 bg-outline-variant/20 hidden md:block" />

        {/* Notifications */}
        <Link href="/notifications" className="relative text-[#8B95A3] hover:text-on-surface transition-colors p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-surface-container" aria-label="Уведомления">
          <span className="material-symbols-outlined text-xl">notifications</span>
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-error rounded-full border-2 border-background text-[9px] font-mono text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>

        {/* User Avatar + Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            aria-label="Меню пользователя"
            className="flex items-center gap-2 cursor-pointer group p-1 -m-1 min-h-[40px]"
          >
            <div className="w-9 h-9 rounded-full bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-xs font-bold text-primary group-hover:border-primary/40 transition-colors">
              {initials}
            </div>
            <span className="hidden lg:flex items-center gap-1 text-[#8B95A3] group-hover:text-on-surface transition-colors">
              <span className="hidden lg:block text-xs font-medium text-on-surface-variant max-w-[80px] truncate">{user?.name?.split(' ')[0]}</span>
              <span className="material-symbols-outlined text-lg">keyboard_arrow_down</span>
            </span>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-48 bg-surface-container-low border border-white/[0.06] rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.04]">
                  <p className="text-xs font-medium text-on-surface truncate">{user?.name}</p>
                  <p className="text-[10px] text-on-surface-variant truncate">{user?.email}</p>
                </div>
                <Link href="/profile" onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-base">account_circle</span>
                  Профиль
                </Link>
                <Link href="/settings" onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-base">settings</span>
                  Настройки
                </Link>
                <div className="border-t border-white/[0.04]" />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-error/70 hover:text-error hover:bg-error/5 transition-colors">
                  <span className="material-symbols-outlined text-base">logout</span>
                  Выйти
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

// Isolated clock: only this tiny component re-renders on the 1s tick.
function HeaderClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () =>
      setTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="hidden md:flex items-center gap-1.5 font-mono text-xs text-on-surface-variant/70 select-none">
      <span className="material-symbols-outlined text-sm">schedule</span>
      <span className="tabular-nums w-[58px]">{time}</span>
    </div>
  )
}
