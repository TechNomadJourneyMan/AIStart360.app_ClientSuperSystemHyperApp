'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  InboxIcon,
  Users2,
  Building2,
  BarChart3,
  PanelsTopLeft,
  Shield,
  LogOut,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { useGigaPanelStore, type ActiveModule } from '@/stores/gigaPanel.store'

interface NavItem {
  id: ActiveModule
  label: string
  icon: React.ReactNode
  badge?: number
}

export function GigaSidebar() {
  const { activeModule, setActiveModule, requests, clients } = useGigaPanelStore()

  // Re-pin the super_admin cookie on every render so Providers can't clear it.
  // If this component renders, middleware already validated the role.
  useEffect(() => {
    document.cookie = 'aistart360_role=super_admin; path=/; max-age=604800; SameSite=Lax'
  })

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  const navItems: NavItem[] = [
    {
      id: 'requests',
      label: 'Заявки',
      icon: <InboxIcon size={18} />,
      badge: pendingCount,
    },
    {
      id: 'crm',
      label: 'CRM / Пользователи',
      icon: <Users2 size={18} />,
    },
    {
      id: 'clients',
      label: 'Клиенты платформы',
      icon: <Building2 size={18} />,
      badge: clients.length > 0 ? clients.length : undefined,
    },
  ]

  const handleNav = (id: NavItem['id']) => {
    setActiveModule(id)
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 flex flex-col z-40
      bg-slate-950/80 backdrop-blur-xl border-r border-white/[0.07]">

      {/* Logo */}
      <div className="px-6 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30
            flex items-center justify-center">
            <Shield size={18} className="text-blue-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 tracking-[0.15em] uppercase">
              ГИГА-Панель
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Super Admin Console</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-6 h-px bg-white/[0.06] mb-4" />

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.id === activeModule

          return (
            <motion.button
              key={item.id}
              onClick={() => handleNav(item.id)}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                text-sm font-medium transition-all duration-200 text-left
                ${isActive
                  ? 'bg-blue-500/15 text-blue-300 border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                }
              `}
            >
              <span className={isActive ? 'text-blue-400' : ''}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>

              {item.badge != null && item.badge > 0 && (
                <span className="flex items-center justify-center h-5 min-w-5 px-1.5
                  rounded-full bg-blue-500 text-white text-[10px] font-bold">
                  {item.badge}
                </span>
              )}

              {isActive && (
                <ChevronRight size={14} className="text-blue-400/60" />
              )}
            </motion.button>
          )
        })}
      </nav>

      {/* Divider */}
      <div className="mx-6 h-px bg-white/[0.06] mb-4" />

      {/* Main product shortcuts */}
      <div className="mx-3 mb-4 space-y-1">
        <p className="px-3 pb-1 text-[10px] uppercase tracking-widest text-slate-600">
          Основной продукт
        </p>
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
        >
          <PanelsTopLeft size={18} />
          <span className="flex-1">Главный дашборд</span>
          <ExternalLink size={13} className="text-slate-600" />
        </Link>
        <Link
          href="/sales-monitoring"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
        >
          <BarChart3 size={18} />
          <span className="flex-1">Мониторинг продаж</span>
          <ExternalLink size={13} className="text-slate-600" />
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-6 h-px bg-white/[0.06] mb-4" />

      {/* Stats summary */}
      <div className="mx-4 mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Статистика</p>
        <div className="space-y-1.5">
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
            <span className="text-emerald-400 font-semibold">
              {requests.filter((r) => r.status === 'approved').length}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Клиентов</span>
            <span className="text-blue-400 font-semibold">{clients.length}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl
          bg-white/[0.03] border border-white/[0.05]">
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
    </aside>
  )
}
