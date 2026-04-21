'use client'

import { motion, AnimatePresence } from 'framer-motion'
import {
  InboxIcon,
  Users2,
  Building2,
  TrendingUp,
  CheckCircle,
  Clock,
  XCircle,
  Shield,
} from 'lucide-react'
import { useGigaPanelStore } from '@/stores/gigaPanel.store'
import { RequestsModule } from '@/components/giga-panel/RequestsModule'
import { CRMModule } from '@/components/giga-panel/CRMModule'
import { ClientsModule } from '@/components/giga-panel/ClientsModule'

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  accent,
  sub,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  accent: string
  sub?: string
}) {
  return (
    <div className={`
      relative overflow-hidden rounded-2xl p-4
      bg-white/[0.04] border border-white/[0.07] backdrop-blur-sm
      hover:border-white/[0.12] transition-all duration-200
    `}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accent}`}>
          {icon}
        </div>
      </div>
      <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{value}</p>
      <p className="text-[10px] md:text-xs text-slate-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-700 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function GigaPanelPage() {
  const { activeModule, setActiveModule, requests, users, clients } = useGigaPanelStore()

  const totalPending = requests.filter((r) => r.status === 'pending').length
  const totalApproved = requests.filter((r) => r.status === 'approved').length
  const totalRejected = requests.filter((r) => r.status === 'rejected').length
  const totalBlocked = users.filter((u) => u.status === 'blocked').length

  return (
    <div className="max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <div className="hidden md:flex items-center gap-2 mb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon-blue.svg" alt="AIStart360" className="w-4 h-4" />
            <span className="text-xs font-semibold text-blue-400 tracking-[0.15em] uppercase">
              ГИГА-Панель
            </span>
          </div>
          <h1 className="text-lg md:text-2xl font-bold text-slate-100 tracking-tight">
            Командный центр
          </h1>
          <p className="text-xs md:text-sm text-slate-500 mt-0.5">
            Системный уровень доступа
          </p>
        </div>

        {/* Module switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07] overflow-x-auto">
          <button
            onClick={() => setActiveModule('requests')}
            className={`
              flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap
              ${activeModule === 'requests'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                : 'text-slate-500 hover:text-slate-300'
              }
            `}
          >
            <InboxIcon size={15} />
            Заявки
            {totalPending > 0 && (
              <span className="flex items-center justify-center h-4 min-w-4 px-1 rounded-full
                bg-blue-500 text-white text-[9px] font-bold">
                {totalPending}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveModule('crm')}
            className={`
              flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap
              ${activeModule === 'crm'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                : 'text-slate-500 hover:text-slate-300'
              }
            `}
          >
            <Users2 size={15} />
            CRM
          </button>
          <button
            onClick={() => setActiveModule('clients')}
            className={`
              flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap
              ${activeModule === 'clients'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                : 'text-slate-500 hover:text-slate-300'
              }
            `}
          >
            <Building2 size={15} />
            Клиенты
            {clients.length > 0 && (
              <span className="flex items-center justify-center h-4 min-w-4 px-1 rounded-full
                bg-blue-500/30 text-blue-300 text-[9px] font-bold">
                {clients.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-6 md:mb-8">
        <KpiCard
          label="Ожидают решения"
          value={totalPending}
          icon={<Clock size={16} className="text-amber-400" />}
          accent="bg-amber-500/15 border border-amber-500/20"
          sub="Требуют внимания"
        />
        <KpiCard
          label="Одобрено"
          value={totalApproved}
          icon={<CheckCircle size={16} className="text-emerald-400" />}
          accent="bg-emerald-500/15 border border-emerald-500/20"
        />
        <KpiCard
          label="Отклонено"
          value={totalRejected}
          icon={<XCircle size={16} className="text-red-400" />}
          accent="bg-red-500/15 border border-red-500/20"
        />
        <KpiCard
          label="Заблокировано"
          value={totalBlocked}
          icon={<TrendingUp size={16} className="text-slate-400" />}
          accent="bg-slate-500/15 border border-slate-500/20"
          sub={`из ${users.length} пользователей`}
        />
        <KpiCard
          label="Клиентов платформы"
          value={clients.length}
          icon={<Building2 size={16} className="text-blue-400" />}
          accent="bg-blue-500/15 border border-blue-500/20"
          sub="В базе данных"
        />
      </div>

      {/* Active module */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeModule}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          {activeModule === 'requests' && <RequestsModule />}
          {activeModule === 'crm' && <CRMModule />}
          {activeModule === 'clients' && <ClientsModule />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
