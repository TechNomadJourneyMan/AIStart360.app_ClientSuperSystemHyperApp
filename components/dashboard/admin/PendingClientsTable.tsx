'use client'

import { useEffect, useState } from 'react'

type PendingUser = {
  id: string
  email: string
  full_name: string
  organization: string
  position: string
  phone: string
  status: string
  created_at: string
  companies: { name: string; industry: string; stage: string }[]
}

export function PendingClientsTable() {
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const fetchUsers = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/admin/pending-users')
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setUsers(json.data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleApprove = async (userId: string) => {
    if (!confirm('Approve this request?')) return
    try {
      const res = await fetch('/api/v1/admin/approve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status: 'approved' })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      fetchUsers()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  const handleReject = async (userId: string) => {
    if (!confirm('Reject this request?')) return
    try {
      const res = await fetch('/api/v1/admin/approve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status: 'rejected' })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      fetchUsers()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  if (loading) return <div className="p-4 text-sm text-on-surface-variant">Loading new requests...</div>
  if (error) return <div className="p-4 text-sm text-error">Error: {error}</div>

  if (users.length === 0) return null // Hide section if no pending users

  return (
    <div className="bg-surface-container-low rounded-2xl border border-primary/20 overflow-hidden mb-6 relative">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div>
          <h2 className="font-headline text-base font-bold text-on-surface flex items-center gap-2">
            New Registration Requests
            <span className="bg-primary/20 text-primary text-[10px] uppercase font-bold px-2 py-0.5 rounded-md">
              {users.length}
            </span>
          </h2>
          <p className="text-[10px] text-on-surface-variant mt-0.5">Administrator decision required</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['User', 'Email', 'Company', 'Date', 'Action'].map(h => (
                <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const companyName = u.companies?.[0]?.name || u.organization || 'Not specified'
              const date = new Date(u.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              
              return (
                <tr key={u.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-on-surface">{u.full_name}</div>
                    <div className="text-[10px] text-on-surface-variant mt-0.5">{u.position || 'Position not specified'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-on-surface-variant">{u.email}</div>
                    <div className="text-[10px] text-on-surface-variant mt-0.5">{u.phone || 'No phone'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {companyName}
                  </td>
                  <td className="px-4 py-3 text-[10px] font-mono text-on-surface-variant whitespace-nowrap">
                    {date}
                  </td>
                  <td className="px-4 py-3 w-[120px]">
                     <div className="flex gap-2">
                       <button onClick={() => handleApprove(u.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors tooltip-base" title="Approve">
                         <span className="material-symbols-outlined text-sm">check</span>
                       </button>
                       <button onClick={() => handleReject(u.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors tooltip-base" title="Reject">
                         <span className="material-symbols-outlined text-sm">close</span>
                       </button>
                     </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
