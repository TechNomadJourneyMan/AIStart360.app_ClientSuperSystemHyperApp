'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle,
  XCircle,
  Archive,
  Clock,
  UserPlus,
  KeyRound,
  HeadphonesIcon,
  Building2,
  Mail,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { useGigaPanelStore, type RequestCategory, type GigaRequest } from '@/stores/gigaPanel.store'
import { RejectModal } from './RejectModal'
import { UserDetailPanel } from './UserDetailPanel'

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: { id: RequestCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'registration', label: 'Регистрация', icon: <UserPlus size={15} /> },
  { id: 'access', label: 'Доступы', icon: <KeyRound size={15} /> },
  { id: 'support', label: 'Поддержка', icon: <HeadphonesIcon size={15} /> },
]

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GigaRequest['status'] }) {
  const map = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/25',
    archived: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  const labels = {
    pending: 'Ожидает',
    approved: 'Принято',
    rejected: 'Отклонено',
    archived: 'Архив',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map[status]}`}>
      {labels[status]}
    </span>
  )
}


// ─── Single request card ──────────────────────────────────────────────────────

function RequestCard({
  request,
  onApprove,
  onReject,
  onArchive,
}: {
  request: GigaRequest
  onApprove: (id: string) => void
  onReject: (req: GigaRequest) => void
  onArchive: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = request.status === 'pending'

  const initials = request.userName
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const formattedDate = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(request.createdAt))

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl bg-white/[0.04] border border-white/[0.07]
        backdrop-blur-sm hover:border-white/[0.12] transition-all duration-200 overflow-hidden"
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/30 to-violet-500/30
            border border-white/[0.1] flex items-center justify-center flex-shrink-0
            text-[13px] font-bold text-blue-300">
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-100 leading-tight">
                  {request.userName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Mail size={11} className="text-slate-600" />
                  <p className="text-[11px] text-slate-500 truncate">{request.userEmail}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {request.source === 'upgrade_modal' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[9px] font-mono tracking-wide">
                    Pro
                  </span>
                )}
                <StatusBadge status={request.status} />
              </div>
            </div>

            <p className="text-xs font-medium text-slate-300 mt-2 leading-snug">
              {request.subject}
            </p>

            <div className="flex items-center gap-3 mt-2">
              {request.company && (
                <div className="flex items-center gap-1">
                  <Building2 size={11} className="text-slate-600" />
                  <span className="text-[10px] text-slate-500">{request.company}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <CalendarDays size={11} className="text-slate-600" />
                <span className="text-[10px] text-slate-500">{formattedDate}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-[11px] text-slate-600
            hover:text-slate-400 transition-colors"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? 'Скрыть' : 'Читать подробнее'}
        </button>
      </div>

      {/* Expanded description + survey data */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-xs text-slate-400 leading-relaxed">{request.description}</p>
                {request.rejectionReason && (
                  <div className="mt-2 pt-2 border-t border-red-500/15">
                    <p className="text-[10px] font-semibold text-red-400 mb-1">Причина отклонения:</p>
                    <p className="text-xs text-red-300/70">{request.rejectionReason}</p>
                  </div>
                )}
              </div>

              {/* Full user detail: survey (editable) + diagnostics + documents + portal */}
              {request.category === 'registration' && (
                <UserDetailPanel userId={request.id} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions (only for pending) */}
      {isPending && (
        <div className="px-4 pb-4 flex items-center gap-2">
          <motion.button
            onClick={() => onApprove(request.id)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
              bg-emerald-500/15 border border-emerald-500/25 text-emerald-300
              hover:bg-emerald-500/25 hover:border-emerald-500/40 transition-all"
          >
            <CheckCircle size={13} />
            Принять
          </motion.button>

          <motion.button
            onClick={() => onReject(request)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
              bg-red-500/15 border border-red-500/25 text-red-300
              hover:bg-red-500/25 hover:border-red-500/40 transition-all"
          >
            <XCircle size={13} />
            Отклонить
          </motion.button>

          <motion.button
            onClick={() => onArchive(request.id)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
              bg-white/[0.05] border border-white/[0.08] text-slate-400
              hover:bg-white/[0.08] hover:text-slate-300 transition-all ml-auto"
          >
            <Archive size={13} />
            Архив
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export function RequestsModule() {
  const {
    activeRequestTab,
    setActiveRequestTab,
    requests,
    isLoadingRequests,
    requestsError,
    setRequests,
    setLoadingRequests,
    setRequestsError,
    approveRequest,
    rejectRequest,
    archiveRequest,
  } = useGigaPanelStore()

  const [rejectTarget, setRejectTarget] = useState<GigaRequest | null>(null)

  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true)
    setRequestsError(null)
    try {
      const res = await fetch('/api/giga-admin/requests')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Ошибка загрузки заявок (HTTP ${res.status})`)
      }
      const data = await res.json()
      setRequests(data.requests ?? [])
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoadingRequests(false)
    }
  }, [setRequests, setLoadingRequests, setRequestsError])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  // API-backed actions
  const handleApprove = async (id: string) => {
    approveRequest(id) // optimistic
    await fetch(`/api/giga-admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
  }

  const handleReject = async (id: string, reason: string) => {
    rejectRequest(id, reason) // optimistic
    await fetch(`/api/giga-admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason }),
    })
  }

  const handleArchive = async (id: string) => {
    archiveRequest(id) // optimistic
    await fetch(`/api/giga-admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive' }),
    })
  }

  const filtered = requests.filter((r) => r.category === activeRequestTab)
  const pendingFiltered = filtered.filter((r) => r.status === 'pending')
  const doneFiltered = filtered.filter((r) => r.status !== 'pending')

  const tabCounts = {
    registration: requests.filter((r) => r.category === 'registration' && r.status === 'pending').length,
    access: requests.filter((r) => r.category === 'access' && r.status === 'pending').length,
    support: requests.filter((r) => r.category === 'support' && r.status === 'pending').length,
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Управление заявками</h1>
          <p className="text-sm text-slate-500 mt-1">
            Все входящие запросы — регистрации, доступы и тикеты поддержки
          </p>
        </div>
        <motion.button
          onClick={fetchRequests}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={isLoadingRequests}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
            text-slate-400 bg-white/[0.05] border border-white/[0.08]
            hover:text-slate-200 hover:bg-white/[0.08] transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isLoadingRequests ? 'animate-spin' : ''} />
          Обновить
        </motion.button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07] w-fit mb-6">
        {TABS.map((tab) => {
          const isActive = activeRequestTab === tab.id
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveRequestTab(tab.id)}
              whileHover={!isActive ? { scale: 1.02 } : {}}
              whileTap={{ scale: 0.97 }}
              className={`
                relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-all duration-200
                ${isActive
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                  : 'text-slate-500 hover:text-slate-300'
                }
              `}
            >
              {tab.icon}
              {tab.label}
              {tabCounts[tab.id] > 0 && (
                <span className={`
                  flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-bold
                  ${isActive ? 'bg-blue-400 text-slate-900' : 'bg-slate-700 text-slate-300'}
                `}>
                  {tabCounts[tab.id]}
                </span>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeRequestTab}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18 }}
        >
          {isLoadingRequests ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw size={20} className="text-slate-600 animate-spin mr-2" />
              <span className="text-sm text-slate-600">Загрузка заявок из Supabase...</span>
            </div>
          ) : requestsError ? (
            <div className="flex flex-col items-center justify-center py-16
              rounded-2xl bg-white/[0.02] border border-red-500/10 border-dashed">
              <p className="text-sm text-red-400">{requestsError}</p>
              <button onClick={fetchRequests} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                Повторить
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16
              rounded-2xl bg-white/[0.02] border border-white/[0.06] border-dashed">
              <Clock size={32} className="text-slate-700 mb-3" />
              <p className="text-sm text-slate-600">
                {requests.length === 0 ? 'Заявок пока нет в базе данных' : 'Нет заявок в этой категории'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pending section */}
              {pendingFiltered.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
                      Ожидают обработки
                    </span>
                    <div className="flex-1 h-px bg-amber-500/15" />
                    <span className="text-xs text-slate-600">{pendingFiltered.length}</span>
                  </div>
                  <div className="grid gap-3">
                    <AnimatePresence>
                      {pendingFiltered.map((req) => (
                        <RequestCard
                          key={req.id}
                          request={req}
                          onApprove={handleApprove}
                          onReject={setRejectTarget}
                          onArchive={handleArchive}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Done section */}
              {doneFiltered.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-widest">
                      Обработанные
                    </span>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                    <span className="text-xs text-slate-600">{doneFiltered.length}</span>
                  </div>
                  <div className="grid gap-3 opacity-60">
                    {doneFiltered.map((req) => (
                      <RequestCard
                        key={req.id}
                        request={req}
                        onApprove={handleApprove}
                        onReject={setRejectTarget}
                        onArchive={handleArchive}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Reject modal */}
      <RejectModal
        isOpen={!!rejectTarget}
        requestId={rejectTarget?.id ?? ''}
        userName={rejectTarget?.userName ?? ''}
        onConfirm={handleReject}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  )
}
