'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  ShieldOff,
  Settings2,
  RefreshCw,
  User,
  Mail,
  Calendar,
  Clock,
  Building2,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  FileText,
  Loader2,
  Pencil,
  Save,
  X,
  ExternalLink,
} from 'lucide-react'
import { useGigaPanelStore, type GigaUser, type UserStatus } from '@/stores/gigaPanel.store'
import { UserSettingsModal } from './UserSettingsModal'
import { SURVEY_LABELS, SURVEY_STEP_LABELS, formatSurveyValue, getStepFromKey } from '@/lib/survey-labels'

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTERS: { id: UserStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'blocked', label: 'Заблокированные' },
  { id: 'pending', label: 'Ожидающие' },
]

// ─── Status chip ──────────────────────────────────────────────────────────────

function UserStatusChip({ status }: { status: UserStatus }) {
  const map = {
    active: {
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
      icon: <CheckCircle size={11} />,
      label: 'Активен',
    },
    blocked: {
      cls: 'bg-red-500/15 text-red-300 border-red-500/25',
      icon: <XCircle size={11} />,
      label: 'Заблокирован',
    },
    pending: {
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
      icon: <AlertCircle size={11} />,
      label: 'Ожидает',
    },
  }
  const { cls, icon, label } = map[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {icon}
      {label}
    </span>
  )
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const colorMap: Record<string, string> = {
    SUPER_ADMIN: 'bg-violet-500/20 text-violet-300 border-violet-500/25',
    ADMIN: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    MANAGER: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
    ANALYST: 'bg-teal-500/15 text-teal-300 border-teal-500/20',
    CLIENT: 'bg-slate-500/15 text-slate-400 border-slate-500/15',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold border ${colorMap[role] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/15'}`}>
      {role}
    </span>
  )
}

// ─── User survey detail (expandable) ─────────────────────────────────────────

function UserSurveyDetail({ userId }: { userId: string }) {
  const [data, setData] = useState<{
    answers: Record<string, unknown>
    company: Record<string, unknown> | null
    completedSteps: number[]
  } | null>(null)
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [impersonating, setImpersonating] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [surveyRes, diagRes] = await Promise.all([
          fetch(`/api/giga-admin/requests/${userId}/survey`),
          fetch(`/api/giga-admin/requests/${userId}/diagnostics`),
        ])
        const surveyJson = await surveyRes.json()
        const diagJson = await diagRes.json()
        if (!cancelled) {
          setData(surveyJson.data ?? null)
          setDiag(diagJson.data ?? null)
        }
      } catch {}
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  const startEditing = () => {
    if (!data) return
    const vals: Record<string, string> = {}
    for (const [k, v] of Object.entries(data.answers)) {
      vals[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
    }
    setEditValues(vals)
    setEditing(true)
  }

  const cancelEditing = () => { setEditing(false); setEditValues({}) }

  const saveEdits = async () => {
    setSaving(true)
    try {
      const answers: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(editValues)) {
        // Try parse numbers
        const num = Number(v)
        answers[k] = !isNaN(num) && v.trim() !== '' && !v.includes(' ') ? num : v
      }
      const res = await fetch(`/api/giga-admin/requests/${userId}/survey`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (res.ok) {
        setData(prev => prev ? { ...prev, answers } : prev)
        setEditing(false)
      }
    } catch {}
    setSaving(false)
  }

  const openAsUser = async () => {
    setImpersonating(true)
    try {
      const res = await fetch('/api/giga-admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (data.url) {
        window.open(data.url, '_blank')
      }
    } catch {}
    setImpersonating(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center">
        <Loader2 size={14} className="text-slate-500 animate-spin" />
        <span className="text-[11px] text-slate-500">Загрузка данных...</span>
      </div>
    )
  }

  const scoreColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button onClick={openAsUser} disabled={impersonating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-300 hover:bg-blue-500/20 transition-all disabled:opacity-50">
          {impersonating ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
          Открыть портал
        </button>
        {data && data.completedSteps.length > 0 && !editing && (
          <button onClick={startEditing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-all">
            <Pencil size={12} />
            Редактировать анкету
          </button>
        )}
        {editing && (
          <>
            <button onClick={saveEdits} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Сохранить
            </button>
            <button onClick={cancelEditing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.05] border border-white/[0.08] text-slate-400 hover:text-slate-300 transition-all">
              <X size={12} />
              Отмена
            </button>
          </>
        )}
      </div>

      {/* Diagnostics summary */}
      {diag && (
        <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText size={12} className="text-violet-400" />
            <span className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider">Результаты диагностики</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Балл</p>
              <p className={`text-lg font-mono font-bold ${scoreColor((diag.overall_score as number) ?? 0)}`}>{(diag.overall_score as number) ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Health</p>
              <p className={`text-lg font-mono font-bold ${scoreColor((diag.health_index as number) ?? 0)}`}>{(diag.health_index as number) ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Стадия</p>
              <p className="text-sm font-mono font-bold text-blue-300">{(diag.stage as string) ?? '—'}</p>
            </div>
          </div>
          {['finance', 'sales', 'operations', 'marketing', 'strategy'].map(key => {
            const block = diag[`${key}_score`] as { score?: number } | null
            const s = block?.score ?? 0
            const labels: Record<string, string> = { finance: 'Финансы', sales: 'Продажи', operations: 'Операции', marketing: 'Маркетинг', strategy: 'Стратегия' }
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-20">{labels[key]}</span>
                <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s}%`, background: s >= 70 ? '#6effc0' : s >= 40 ? '#fbbf24' : '#ef4444' }} />
                </div>
                <span className={`text-[10px] font-mono font-bold w-8 text-right ${scoreColor(s)}`}>{s}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Survey answers (view or edit mode) */}
      {data && data.completedSteps.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText size={12} className="text-blue-400" />
            <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wider">
              Данные анкеты {editing && <span className="text-amber-400 ml-1">(редактирование)</span>}
            </span>
          </div>
          {data.completedSteps.map(step => {
            const fields = Object.entries(editing ? editValues : data.answers)
              .filter(([k]) => getStepFromKey(k) === step)
              .map(([k, v]) => ({ key: k, label: SURVEY_LABELS[k] || k, value: editing ? String(v ?? '') : formatSurveyValue(k, v) }))
            if (!fields.length) return null
            return (
              <div key={step} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {SURVEY_STEP_LABELS[step] || `Шаг ${step}`}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {fields.map(f => (
                    <div key={f.key} className="flex flex-col py-0.5">
                      <span className="text-[9px] text-slate-600">{f.label}</span>
                      {editing ? (
                        <input
                          type="text"
                          value={editValues[f.key] ?? ''}
                          onChange={e => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="mt-0.5 px-2 py-1 rounded bg-white/[0.05] border border-white/[0.1] text-[11px] text-slate-200 focus:border-blue-500/40 focus:outline-none transition-all"
                        />
                      ) : (
                        <span className="text-[11px] text-slate-300 leading-tight">{f.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : !diag ? (
        <p className="text-[11px] text-slate-600 italic py-2">Анкета не заполнена</p>
      ) : null}
    </div>
  )
}

// ─── User row ─────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onBlock,
  onOpenSettings,
}: {
  user: GigaUser
  onBlock: (user: GigaUser) => void
  onOpenSettings: (user: GigaUser) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const initials = (user.name ?? user.email)
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    }).format(new Date(iso))
  }

  // Check if user has survey/diagnostics from extended API data
  const ext = user as GigaUser & { surveyCompleted?: boolean; diagnostics?: unknown }
  const hasSurvey = ext.surveyCompleted || !!ext.diagnostics

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setExpanded(v => !v)}
        className={`group border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors cursor-pointer ${expanded ? 'bg-white/[0.03]' : ''}`}
      >
        {/* User info */}
        <td className="py-3 pl-4 pr-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/25 to-violet-500/25
              border border-white/[0.1] flex items-center justify-center flex-shrink-0
              text-[11px] font-bold text-blue-300">
              {initials.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-200 truncate max-w-[140px]">
                  {user.name ?? '—'}
                </p>
                {hasSurvey && (
                  <span className="text-[8px] bg-emerald-500/15 text-emerald-400 px-1 py-0.5 rounded">Анкета</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate max-w-[140px]">{user.email}</p>
            </div>
          </div>
        </td>

        {/* Role */}
        <td className="py-3 px-3">
          <RoleBadge role={user.role} />
        </td>

        {/* Status */}
        <td className="py-3 px-3">
          <UserStatusChip status={user.status} />
        </td>

        {/* Org */}
        <td className="py-3 px-3">
          <span className="text-xs text-slate-500 truncate max-w-[100px] block">
            {user.org ?? '—'}
          </span>
        </td>

        {/* Dates */}
        <td className="py-3 px-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <Calendar size={10} className="text-slate-700" />
              <span className="text-[10px] text-slate-600">{formatDate(user.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-slate-700" />
              <span className="text-[10px] text-slate-600">{formatDate(user.lastLogin)}</span>
            </div>
          </div>
        </td>

        {/* Actions */}
        <td className="py-3 pl-3 pr-4">
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <motion.button
              onClick={(e) => { e.stopPropagation(); onOpenSettings(user) }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              title="Настройки дашборда"
              className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]
                text-slate-400 hover:text-blue-300 hover:border-blue-500/30
                hover:bg-blue-500/10 transition-all"
            >
              <Settings2 size={13} />
            </motion.button>

            {user.status !== 'blocked' && (
              <motion.button
                onClick={(e) => { e.stopPropagation(); onBlock(user) }}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                title="Заблокировать пользователя"
                className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]
                  text-slate-400 hover:text-red-300 hover:border-red-500/30
                  hover:bg-red-500/10 transition-all"
              >
                <ShieldOff size={13} />
              </motion.button>
            )}
          </div>
        </td>
      </motion.tr>
      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-white/[0.02] border-b border-white/[0.05]">
            <UserSurveyDetail userId={user.id} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main CRM module ──────────────────────────────────────────────────────────

export function CRMModule() {
  const {
    users,
    isLoadingUsers,
    usersError,
    setUsers,
    setLoadingUsers,
    setUsersError,
    blockUser,
    updateUserWidgets,
  } = useGigaPanelStore()

  const [filter, setFilter] = useState<UserStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [settingsUser, setSettingsUser] = useState<GigaUser | null>(null)
  const [blockConfirm, setBlockConfirm] = useState<GigaUser | null>(null)
  const [sortField, setSortField] = useState<'name' | 'createdAt'>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true)
    setUsersError(null)
    try {
      const res = await fetch('/api/giga-admin/users')
      if (!res.ok) throw new Error('Ошибка загрузки пользователей')
      const data = await res.json()
      setUsers(data.users)
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoadingUsers(false)
    }
  }, [setUsers, setLoadingUsers, setUsersError])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleBlock = async (user: GigaUser) => {
    setBlockConfirm(null)
    try {
      await fetch(`/api/giga-admin/users/${user.id}/block`, { method: 'POST' })
      blockUser(user.id)
    } catch {
      // handle silently for now
    }
  }

  const handleSaveWidgets = async (userId: string, widgets: string[]) => {
    updateUserWidgets(userId, widgets)
    await fetch(`/api/giga-admin/users/${userId}/widgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgets }),
    })
  }

  const toggleSort = (field: 'name' | 'createdAt') => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filtered = users
    .filter((u) => (filter === 'all' ? true : u.status === filter))
    .filter((u) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        u.name?.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.org?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const aVal = sortField === 'name' ? (a.name ?? '') : (a.createdAt ?? '')
      const bVal = sortField === 'name' ? (b.name ?? '') : (b.createdAt ?? '')
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })

  const SortIcon = ({ field }: { field: 'name' | 'createdAt' }) =>
    sortField === field ? (
      sortDir === 'asc' ? (
        <ChevronUp size={12} className="text-blue-400" />
      ) : (
        <ChevronDown size={12} className="text-blue-400" />
      )
    ) : (
      <ChevronDown size={12} className="text-slate-700" />
    )

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">CRM / Пользователи</h1>
          <p className="text-sm text-slate-500 mt-1">
            Управление аккаунтами, блокировки, настройки дашбордов
          </p>
        </div>
        <motion.button
          onClick={fetchUsers}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={isLoadingUsers}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
            text-slate-400 bg-white/[0.05] border border-white/[0.08]
            hover:text-slate-200 hover:bg-white/[0.08] transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isLoadingUsers ? 'animate-spin' : ''} />
          Обновить
        </motion.button>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1 md:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, email, компании..."
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08]
              text-sm text-slate-200 placeholder:text-slate-700
              focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20
              transition-all"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          {FILTERS.map((f) => {
            const isActive = filter === f.id
            const count = f.id === 'all' ? users.length : users.filter((u) => u.status === f.id).length
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  transition-all duration-200
                  ${isActive
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                    : 'text-slate-500 hover:text-slate-300'
                  }
                `}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[9px] ${isActive ? 'text-blue-300' : 'text-slate-700'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
        {isLoadingUsers ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={20} className="text-slate-600 animate-spin mr-2" />
            <span className="text-sm text-slate-600">Загрузка пользователей...</span>
          </div>
        ) : usersError ? (
          <div className="flex flex-col items-center justify-center py-16">
            <XCircle size={28} className="text-red-500/50 mb-2" />
            <p className="text-sm text-slate-500">{usersError}</p>
            <button onClick={fetchUsers} className="mt-3 text-xs text-blue-400 hover:text-blue-300">
              Попробовать снова
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <User size={28} className="text-slate-700 mb-2" />
            <p className="text-sm text-slate-600">Пользователи не найдены</p>
          </div>
        ) : (
          <>
          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-white/[0.05]">
            {filtered.map((user) => (
                <div key={user.id} className="p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <User size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{user.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                    </div>
                    <UserStatusChip status={user.status} />
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-600">
                    <span className="bg-white/[0.05] px-1.5 py-0.5 rounded text-slate-400">{user.role}</span>
                    {user.org && <span className="truncate">{user.org}</span>}
                  </div>
                </div>
            ))}
          </div>
          {/* Desktop table */}
          <table className="w-full hidden md:table">
            <thead>
              <tr className="border-b border-white/[0.07]">
                <th className="py-3 pl-4 pr-3 text-left">
                  <button
                    onClick={() => toggleSort('name')}
                    className="flex items-center gap-1 text-[10px] font-semibold
                      text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors"
                  >
                    Пользователь <SortIcon field="name" />
                  </button>
                </th>
                <th className="py-3 px-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Роль
                </th>
                <th className="py-3 px-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Статус
                </th>
                <th className="py-3 px-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Компания
                </th>
                <th className="py-3 px-3 text-left">
                  <button
                    onClick={() => toggleSort('createdAt')}
                    className="flex items-center gap-1 text-[10px] font-semibold
                      text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors"
                  >
                    Даты <SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="py-3 pl-3 pr-4 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filtered.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onBlock={setBlockConfirm}
                    onOpenSettings={setSettingsUser}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          </>
        )}
      </div>

      {/* Block confirmation */}
      <AnimatePresence>
        {blockConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBlockConfirm(null)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2
                bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/50 p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/20
                  flex items-center justify-center">
                  <ShieldOff size={17} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Заблокировать пользователя?</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{blockConfirm.name ?? blockConfirm.email}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mb-5">
                Сессия пользователя будет немедленно аннулирована. Действие можно отменить позже.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setBlockConfirm(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium
                    text-slate-400 bg-white/[0.05] border border-white/[0.08]
                    hover:bg-white/[0.08] transition-all"
                >
                  Отмена
                </button>
                <motion.button
                  onClick={() => handleBlock(blockConfirm)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                    bg-red-500/20 border border-red-500/30 text-red-300
                    hover:bg-red-500/30 transition-all"
                >
                  Заблокировать
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Widget settings modal */}
      <UserSettingsModal
        isOpen={!!settingsUser}
        user={settingsUser}
        onSave={handleSaveWidgets}
        onClose={() => setSettingsUser(null)}
      />
    </div>
  )
}
