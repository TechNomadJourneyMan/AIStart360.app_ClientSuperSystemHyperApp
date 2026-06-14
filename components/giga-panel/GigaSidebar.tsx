'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  InboxIcon,
  Users2,
  Building2,
  Lightbulb,
  Shield,
  LogOut,
  ChevronRight,
  X,
} from 'lucide-react'
import { useGigaPanelStore, type ActiveModule } from '@/stores/gigaPanel.store'

interface NavItem {
  id: ActiveModule | 'overview'
  label: string
  icon: React.ReactNode
  badge?: number
  disabled?: boolean
}

interface GigaSidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function GigaSidebar({ isOpen = false, onClose }: GigaSidebarProps) {
  const { activeModule, setActiveModule, requests, clients } = useGigaPanelStore()

  // NOTE: super-admin access is gated by the signed, httpOnly `aistart360_giga`
  // cookie set server-side at /api/giga-admin/auth. The client must NOT write a
  // role cookie — an unsigned `aistart360_role=super_admin` would be a forgeable
  // privilege-escalation vector and is no longer trusted by any reader.

  // Close mobile drawer on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Обзор', icon: <LayoutDashboard size={18} />, disabled: true },
    { id: 'requests', label: 'Заявки', icon: <InboxIcon size={18} />, badge: pendingCount },
    { id: 'crm', label: 'CRM / Пользователи', icon: <Users2 size={18} /> },
    { id: 'clients', label: 'Клиенты платформы', icon: <Building2 size={18} />, badge: clients.length > 0 ? clients.length : undefined },
    { id: 'market-insights', label: 'Инсайты рынка', icon: <Lightbulb size={18} /> },
  ]

  const handleNav = (id: NavItem['id'], disabled?: boolean) => {
    if (disabled) return
    setActiveModule(id as ActiveModule)
    onClose?.() // close mobile drawer on navigation
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 md:px-6 pt-6 md:pt-8 pb-4 md:pb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon-blue.svg" alt="AIStart360" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 tracking-[0.15em] uppercase">ГИГА-Панель</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Super Admin Console</p>
          </div>
        </div>
        {/* Mobile close button */}
        <button onClick={onClose} className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="mx-5 md:mx-6 h-px bg-white/[0.06] mb-4" />

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.id === activeModule
          const isDisabled = !!item.disabled
          return (
            <motion.button
              key={item.id}
              onClick={() => handleNav(item.id, item.disabled)}
              whileHover={!isDisabled ? { x: 2 } : {}}
              whileTap={!isDisabled ? { scale: 0.98 } : {}}
              disabled={isDisabled}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                text-sm font-medium transition-all duration-200 text-left
                ${isActive
                  ? 'bg-blue-500/15 text-blue-300 border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
                  : isDisabled
                    ? 'text-slate-600 cursor-not-allowed'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                }
              `}
            >
              <span className={isActive ? 'text-blue-400' : ''}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                  {item.badge}
                </span>
              )}
              {isActive && <ChevronRight size={14} className="text-blue-400/60" />}
            </motion.button>
          )
        })}
      </nav>

      <div className="mx-5 md:mx-6 h-px bg-white/[0.06] mb-4" />

      {/* Stats summary */}
      <div className="mx-3 md:mx-4 mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Статистика</p>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Всего заявок</span>
            <span className="text-slate-300 font-semibold">{requests.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Ожидают</span>
            <span className="text-amber-400 font-semibold">{pendingCount}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Одобрено</span>
            <span className="text-emerald-400 font-semibold">{requests.filter((r) => r.status === 'approved').length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Клиентов</span>
            <span className="text-blue-400 font-semibold">{clients.length}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 md:px-4 pb-4 md:pb-6">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Shield size={13} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-slate-300 truncate">SUPER_ADMIN</p>
            <p className="text-[10px] text-slate-600 truncate">Системный доступ</p>
          </div>
          <button className="text-slate-600 hover:text-red-400 transition-colors">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-64 flex-col z-40 bg-slate-950/80 backdrop-blur-xl border-r border-white/[0.07]">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />
            {/* Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="md:hidden fixed left-0 top-0 h-screen w-72 flex flex-col z-50 bg-slate-950/95 backdrop-blur-xl border-r border-white/[0.07]"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
