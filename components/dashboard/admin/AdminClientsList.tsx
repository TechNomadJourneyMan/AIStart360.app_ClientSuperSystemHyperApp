'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type AdminClientRow = {
  id: string
  name: string
  industry: string
  gri: number
  phase: string
  manager: string
  status: string
}

const STATUS_CONFIG = {
  active:   { label: 'Активен',       color: 'text-primary',   dot: 'bg-primary'   },
  at_risk:  { label: 'В зоне риска',  color: 'text-secondary', dot: 'bg-secondary' },
  critical: { label: 'Критично',      color: 'text-error',     dot: 'bg-error'     },
  pending_approval: { label: 'Ожидает', color: 'text-on-surface-variant', dot: 'bg-on-surface-variant' }
}

function GriBar({ score }: { score: number }) {
  const color = score >= 7 ? 'bg-primary' : score >= 5 ? 'bg-secondary' : 'bg-error'
  const textColor = score >= 7 ? 'text-primary' : score >= 5 ? 'text-secondary' : 'text-error'
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-6 text-right ${textColor}`}>{score}</span>
    </div>
  )
}

export function AdminClientsList() {
  const [clients, setClients] = useState<AdminClientRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const res = await fetch('/api/v1/admin/clients')
        const json = await res.json()
        if (json.ok) {
          const mapped = json.data.map((c: any) => ({
            id: c.id,
            name: c.company_name || c.full_name || 'Без названия',
            industry: c.industry || '—',
            gri: c.overall_score ? Math.round(c.overall_score / 10 * 10) / 10 : 0, // Score is 0-100 in DB, but table uses 0.0 format
            phase: c.stage || '—',
            manager: 'Марина Р.', // Placeholder for now as manager system isn't in DB yet
            status: c.status === 'approved' ? 'active' : c.status === 'pending_approval' ? 'pending_approval' : 'at_risk'
          })).sort((a: AdminClientRow, b: AdminClientRow) => {
            if (a.name.toLowerCase().includes('choco')) return -1;
            if (b.name.toLowerCase().includes('choco')) return 1;
            return 0;
          })
          setClients(mapped)
        }
      } catch (err) {
        console.error('Failed to fetch clients:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchClients()
  }, [])

  if (loading) return <div className="p-8 text-center text-sm text-on-surface-variant">Загрузка базы клиентов...</div>

  return (
    <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div>
          <h2 className="font-headline text-base font-bold text-on-surface">Клиенты платформы</h2>
          <p className="text-[10px] text-on-surface-variant">GRI · фаза · ответственный менеджер</p>
        </div>
        <Link href="/clients" className="text-xs font-mono text-primary hover:underline">Все →</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['Компания', 'Отрасль', 'GRI', 'Фаза', 'Менеджер', 'Статус'].map(h => (
                <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const st = STATUS_CONFIG[c.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active
              return (
                <tr key={c.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center text-[9px] font-bold text-primary flex-shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <Link href={`/clients/${c.id}`} className="text-sm font-medium text-on-surface hover:text-primary transition-colors">
                        {c.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-on-surface-variant">{c.industry}</span></td>
                  <td className="px-4 py-3"><GriBar score={c.gri} /></td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-1 rounded-md whitespace-nowrap">{c.phase}</span>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-on-surface-variant">{c.manager}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                      <span className={`text-[10px] font-mono ${st.color}`}>{st.label}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-on-surface-variant">Нет активных клиентов</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
