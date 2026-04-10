'use client'

import Link from 'next/link'

export interface CrmRequest {
  id: string
  type: string
  status: string
  companyName: string | null
  createdAt: string
  priority: string
}

export interface CrmClient {
  id: string
  name: string
  industry: string
  stage: string
  status: string
}

interface CrmActivityProps {
  requests: CrmRequest[]
  clients: CrmClient[]
  pendingCount: number
}

const STATUS_COLORS: Record<string, string> = {
  new:              'text-amber-400 bg-amber-400/10 border-amber-400/20',
  in_review:        'text-blue-400 bg-blue-400/10 border-blue-400/20',
  waiting_for_info: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  approved:         'text-primary bg-primary/10 border-primary/20',
  rejected:         'text-error bg-error/10 border-error/20',
  escalated:        'text-purple-400 bg-purple-400/10 border-purple-400/20',
}

const STATUS_LABELS: Record<string, string> = {
  new:              'Новая',
  in_review:        'На проверке',
  waiting_for_info: 'Ждёт инфо',
  approved:         'Одобрено',
  rejected:         'Отклонено',
  escalated:        'Эскалировано',
}

const TYPE_LABELS: Record<string, string> = {
  registration: 'Регистрация',
  access:       'Доступ',
  support:      'Поддержка',
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-error animate-pulse',
  high:     'bg-amber-400',
  medium:   'bg-primary/60',
  low:      'bg-on-surface-variant/40',
}

const CLIENT_STAGE: Record<string, string> = {
  Seed: 'text-on-surface-variant',
  Early: 'text-amber-400',
  Growth: 'text-primary',
  Scale: 'text-blue-400',
  Mature: 'text-purple-400',
}

export function CrmActivity({ requests, clients, pendingCount }: CrmActivityProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface">CRM — Активность</h3>
        <Link href="/admin/requests"
          className="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors">
          Все заявки →
        </Link>
      </div>

      {/* Pending count badge */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2.5 bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-xs text-amber-400">
            <span className="font-bold">{pendingCount}</span> заявок ожидают проверки
          </span>
          <Link href="/admin/requests?status=new" className="ml-auto text-[10px] font-mono text-amber-400/70 hover:text-amber-400 transition-colors">
            Открыть →
          </Link>
        </div>
      )}

      {/* Recent requests */}
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Последние заявки</p>
        </div>
        {requests.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <span className="text-xs text-on-surface-variant">Нет заявок</span>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {requests.map((req) => {
              const statusStyle = STATUS_COLORS[req.status] ?? 'text-on-surface-variant bg-surface-container border-white/10'
              const priorityDot = PRIORITY_DOT[req.priority] ?? 'bg-on-surface-variant/40'
              return (
                <div key={req.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-on-surface truncate font-medium">
                      {req.companyName ?? TYPE_LABELS[req.type] ?? req.type}
                    </p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">
                      {TYPE_LABELS[req.type] ?? req.type} · {new Date(req.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${statusStyle} flex-shrink-0`}>
                    {STATUS_LABELS[req.status] ?? req.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent clients */}
      {clients.length > 0 && (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Клиенты CRM</p>
            <Link href="/clients" className="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors">
              Все →
            </Link>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {clients.map((client) => (
              <div key={client.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-primary">
                    {client.name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-on-surface truncate">{client.name}</p>
                  <p className="text-[10px] text-on-surface-variant">{client.industry}</p>
                </div>
                <span className={`text-[9px] font-mono ${CLIENT_STAGE[client.stage] ?? 'text-on-surface-variant'}`}>
                  {client.stage}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
