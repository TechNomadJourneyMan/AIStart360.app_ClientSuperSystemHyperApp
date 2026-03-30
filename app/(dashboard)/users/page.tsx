'use client'

import { useState, useEffect } from 'react'
import type { Metadata } from 'next'
import { usersService, type PublicUser } from '@/shared/api/users.service'

const ROLE_STYLES: Record<string, { text: string; bg: string; border: string; label: string }> = {
  admin:  { text: 'text-primary',   bg: 'bg-primary/10',   border: 'border-primary/20',   label: 'Администратор' },
  expert: { text: 'text-secondary', bg: 'bg-secondary/10', border: 'border-secondary/20', label: 'Эксперт'       },
  owner:  { text: 'text-tertiary-container', bg: 'bg-tertiary-container/10', border: 'border-tertiary-container/20', label: 'Владелец' },
}

const ROLE_FALLBACK = { text: 'text-on-surface-variant', bg: 'bg-surface-container', border: 'border-outline-variant/20', label: 'Пользователь' }

function getRoleStyle(role: string) {
  return ROLE_STYLES[role] ?? ROLE_FALLBACK
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/[0.02]">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-5 py-4">
          <div className="h-3.5 rounded-lg skeleton" style={{ width: `${[140, 80, 100, 80, 90, 60][i]}px` }} />
        </td>
      ))}
    </tr>
  )
}

export default function UsersPage() {
  const [users, setUsers]       = useState<PublicUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'expert'>('all')
  const [stats, setStats]       = useState({ total: 0, admins: 0, experts: 0, activeToday: 0 })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selected, setSelected] = useState<PublicUser | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', role: 'expert' as 'admin'|'expert'|'owner', organization: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addDone, setAddDone] = useState(false)

  const handleAddUser = async () => {
    if (!addForm.name.trim() || !addForm.email.trim()) return
    setAddSaving(true)
    await new Promise(r => setTimeout(r, 800)) // имитация API
    const newUser: PublicUser = {
      id: Date.now().toString(),
      name: addForm.name.trim(),
      email: addForm.email.trim(),
      role: addForm.role,
      organization: addForm.organization || undefined,
      createdAt: new Date().toISOString(),
      lastLogin: null,
    } as unknown as PublicUser
    setUsers(prev => [newUser, ...prev])
    setStats(prev => ({
      ...prev,
      total: prev.total + 1,
      admins: prev.admins + (addForm.role === 'admin' ? 1 : 0),
      experts: prev.experts + (addForm.role === 'expert' ? 1 : 0),
    }))
    setAddSaving(false)
    setAddDone(true)
    setTimeout(() => { setShowAddModal(false); setAddDone(false); setAddForm({ name:'', email:'', role:'expert', organization:'' }) }, 1500)
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [all, s] = await Promise.all([usersService.getAll(), usersService.getStats()])
    setUsers(all)
    setStats(s)
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    await usersService.delete(id)
    setUsers((prev) => prev.filter((u) => u.id !== id))
    setStats((prev) => ({
      ...prev,
      total: prev.total - 1,
      admins: prev.admins - (users.find(u => u.id === id)?.role === 'admin' ? 1 : 0),
      experts: prev.experts - (users.find(u => u.id === id)?.role === 'expert' ? 1 : 0),
    }))
    if (selected?.id === id) setSelected(null)
    setDeleting(null)
  }

  const filtered = users.filter((u) => {
    const matchRole   = roleFilter === 'all' || u.role === roleFilter
    const matchSearch = !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.organization ?? '').toLowerCase().includes(search.toLowerCase())
    return matchRole && matchSearch
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Администрирование</p>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl md:text-3xl font-extrabold text-on-surface">Управление пользователями</h1>
            <p className="text-on-surface-variant mt-2 text-sm">Просмотр, фильтрация и управление аккаунтами</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="self-start flex items-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2.5 rounded-xl font-bold hover:scale-[0.98] transition-all whitespace-nowrap flex-shrink-0">
            <span className="material-symbols-outlined text-lg">person_add</span>
            Добавить
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Всего',        value: stats.total,       icon: 'groups',            color: 'text-on-surface' },
          { label: 'Администраторов', value: stats.admins,   icon: 'admin_panel_settings', color: 'text-primary'  },
          { label: 'Экспертов',    value: stats.experts,     icon: 'psychology',         color: 'text-secondary' },
          { label: 'Активны сегодня', value: stats.activeToday, icon: 'online_prediction', color: 'text-primary' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
              <span className={`material-symbols-outlined text-base ${s.color} opacity-50`}>{s.icon}</span>
            </div>
            <p className={`text-3xl font-mono font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </section>

      {/* Table + Detail */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table */}
        <div className={`${selected ? 'lg:col-span-2' : 'lg:col-span-3'} bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden`}>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 px-4 md:px-5 py-4 border-b border-white/[0.04]">
            <div className="relative flex-1 min-w-[160px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-lg">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="w-full bg-surface-container border border-white/[0.06] rounded-xl pl-9 pr-4 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {([['all', 'Все'], ['admin', 'Админы'], ['expert', 'Эксперты']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setRoleFilter(v)}
                  className={`text-xs font-mono px-3 py-2 rounded-xl border transition-colors whitespace-nowrap ${
                    roleFilter === v ? 'bg-primary/10 text-primary border-primary/20' : 'text-on-surface-variant border-white/[0.06] hover:border-white/[0.12]'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile cards (< md) */}
          <div className="md:hidden divide-y divide-white/[0.04]">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="px-4 py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl skeleton flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 rounded skeleton w-32" />
                      <div className="h-2.5 rounded skeleton w-44" />
                    </div>
                  </div>
                ))
              : filtered.map((user) => {
                  const rs = getRoleStyle(user.role)
                  const isActive = user.lastLogin && new Date(user.lastLogin).toDateString() === new Date().toDateString()
                  return (
                    <div key={user.id}
                      onClick={() => setSelected(selected?.id === user.id ? null : user)}
                      className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors active:bg-white/[0.04] ${
                        selected?.id === user.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                      }`}>
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center text-[11px] font-bold text-primary flex-shrink-0">
                        {user.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-on-surface truncate">{user.name}</p>
                          <span className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${rs.bg} ${rs.text} ${rs.border}`}>
                            {rs.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface-variant truncate mt-0.5">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-primary animate-pulse' : 'bg-outline'}`} />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(user.id) }}
                          disabled={deleting === user.id}
                          className="text-error/30 hover:text-error transition-colors disabled:opacity-30 p-1">
                          <span className="material-symbols-outlined text-lg">
                            {deleting === user.id ? 'hourglass_empty' : 'delete_outline'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )
                })
            }
          </div>

          {/* Desktop table (≥ md) */}
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                {['Пользователь', 'Роль', 'Организация', 'Статус', 'Последний вход', ''].map((h) => (
                  <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
                : filtered.map((user) => {
                  const role = getRoleStyle(user.role)
                  const isActive = user.lastLogin && new Date(user.lastLogin).toDateString() === new Date().toDateString()
                  return (
                    <tr key={user.id}
                      onClick={() => setSelected(selected?.id === user.id ? null : user)}
                      className={`border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer ${selected?.id === user.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center text-[11px] font-bold text-primary flex-shrink-0">
                            {user.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-on-surface">{user.name}</p>
                            <p className="text-[10px] text-on-surface-variant">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full border ${role.bg} ${role.text} ${role.border}`}>
                          {role.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-on-surface-variant">{user.organization ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-primary animate-pulse' : 'bg-outline'}`} />
                          <span className="text-xs text-on-surface-variant">{isActive ? 'Сегодня' : 'Оффлайн'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono text-on-surface-variant">
                        {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('ru-RU') : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(user.id) }}
                          disabled={deleting === user.id}
                          className="text-error/40 hover:text-error transition-colors disabled:opacity-30">
                          <span className="material-symbols-outlined text-lg">
                            {deleting === user.id ? 'hourglass_empty' : 'delete_outline'}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
          </div>{/* end overflow-x-auto */}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 block mb-3">search_off</span>
              <p className="text-sm text-on-surface-variant">Пользователи не найдены</p>
              <button onClick={() => { setSearch(''); setRoleFilter('all') }} className="mt-3 text-xs text-primary hover:underline font-mono">
                Сбросить фильтры
              </button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 md:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-headline font-bold text-on-surface">Детали</h3>
              <button onClick={() => setSelected(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Avatar */}
            <div className="flex flex-col items-center text-center pt-2">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/20 flex items-center justify-center mb-3">
                <span className="text-xl font-headline font-bold text-primary">
                  {selected.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                </span>
              </div>
              <h4 className="text-sm font-medium text-on-surface">{selected.name}</h4>
              <p className="text-xs text-on-surface-variant mt-0.5">{selected.position ?? selected.role}</p>
              <span className={`text-[10px] font-mono mt-2 px-2.5 py-1 rounded-full border ${getRoleStyle(selected.role).bg} ${getRoleStyle(selected.role).text} ${getRoleStyle(selected.role).border}`}>
                {getRoleStyle(selected.role).label}
              </span>
            </div>

            {/* Fields */}
            <div className="space-y-3">
              {[
                { icon: 'mail', label: 'Email', value: selected.email },
                { icon: 'business', label: 'Организация', value: selected.organization ?? '—' },
                { icon: 'calendar_today', label: 'Регистрация', value: new Date(selected.createdAt).toLocaleDateString('ru-RU') },
                { icon: 'login', label: 'Последний вход', value: selected.lastLogin ? new Date(selected.lastLogin).toLocaleDateString('ru-RU') : '—' },
              ].map((f) => (
                <div key={f.label} className="flex items-start gap-3 bg-surface-container rounded-xl p-3">
                  <span className="material-symbols-outlined text-base text-primary/40 mt-0.5">{f.icon}</span>
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{f.label}</p>
                    <p className="text-xs text-on-surface mt-0.5 break-all">{f.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Permissions */}
            <div className="bg-surface-container rounded-xl p-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">Права доступа</p>
              <div className="space-y-2">
                {(selected.role === 'admin'
                  ? ['Все разделы', 'Управление пользователями', 'Аналитика', 'Настройки']
                  : ['Свой дэшборд', 'Свои отчёты', 'GRI-диагностика', 'Инсайты']
                ).map((perm) => (
                  <div key={perm} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-primary">check_circle</span>
                    <span className="text-xs text-on-surface-variant">{perm}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Add User Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !addSaving && setShowAddModal(false)} />
          <div className="relative bg-[#13151c] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl z-10">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg text-primary">person_add</span>
                </div>
                <p className="text-sm font-semibold text-on-surface">Новый пользователь</p>
              </div>
              <button onClick={() => !addSaving && setShowAddModal(false)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {addDone ? (
                <div className="text-center py-6">
                  <span className="material-symbols-outlined text-5xl text-primary block mb-2">check_circle</span>
                  <p className="text-sm font-medium text-on-surface">Пользователь добавлен</p>
                </div>
              ) : (
                <>
                  {[
                    { label: 'Имя', key: 'name', placeholder: 'Алия Сейтова', type: 'text' },
                    { label: 'Email', key: 'email', placeholder: 'aliya@company.kz', type: 'email' },
                    { label: 'Организация', key: 'organization', placeholder: 'ТОО "Компания"', type: 'text' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">{field.label}</label>
                      <input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={addForm[field.key as keyof typeof addForm]}
                        onChange={e => setAddForm(f => ({ ...f, [field.key]: e.target.value }))}
                        className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/30 transition-all"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest block mb-1">Роль</label>
                    <div className="flex gap-2">
                      {(['admin', 'expert', 'owner'] as const).map(r => (
                        <button key={r} onClick={() => setAddForm(f => ({ ...f, role: r }))}
                          className={`flex-1 py-2 rounded-xl border text-xs font-mono transition-colors ${
                            addForm.role === r ? 'bg-primary/10 border-primary/30 text-primary' : 'border-white/[0.06] text-on-surface-variant hover:border-white/[0.12]'
                          }`}>
                          {getRoleStyle(r).label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setShowAddModal(false)} disabled={addSaving}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors disabled:opacity-40">
                      Отмена
                    </button>
                    <button onClick={handleAddUser} disabled={addSaving || !addForm.name.trim() || !addForm.email.trim()}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {addSaving ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                          Сохранение...
                        </span>
                      ) : 'Добавить'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
