export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { EmptyState } from '@/components/common/EmptyState'

export const metadata: Metadata = { title: 'Intelligence Hub — Аналитический центр' }

export default async function IntelligencePage() {
  const [auditEvents, clientCount] = await Promise.all([
    prisma.auditLog.count(),
    prisma.client.count(),
  ])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Intelligence <span className="text-gradient">Hub</span></h1>
          <p className="text-on-surface-variant text-sm mt-1">Рыночные сигналы, риски и возможности вашей компании</p>
        </div>
      </div>

      {/* Signal Stats — real platform counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'События аудита', value: String(auditEvents), icon: 'hub', color: 'text-on-surface' },
          { label: 'Клиенты', value: String(clientCount), icon: 'groups', color: 'text-primary' },
          { label: 'AI Инсайты', value: '0', icon: 'auto_awesome', color: 'text-tertiary-container' },
          { label: 'Статус систем', value: 'Active', icon: 'cloud_done', color: 'text-success' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className={`material-symbols-outlined text-xl ${stat.color}`}>{stat.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
            </div>
            <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <EmptyState
        icon="sensors"
        title="Сигналов пока нет"
        description="Рыночные сигналы и инсайты появятся после подключения источников данных и прохождения диагностики."
      />
    </div>
  )
}
