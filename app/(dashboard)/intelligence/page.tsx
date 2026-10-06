export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { EmptyState } from '@/components/common/EmptyState'
import { getIntelligenceStats, type PlatformHealth, type Stat } from '@/lib/intelligence/stats'

export const metadata: Metadata = { title: 'Аналитический центр' }

interface Tile {
  label: string
  value: string
  hint: string
  icon: string
  color: string
}

const FAILED = 'не удалось загрузить'

function countTile(label: string, icon: string, color: string, s: Stat<number>, hint: string): Tile {
  return s.ok
    ? { label, icon, color, value: String(s.value), hint }
    : { label, icon, color: 'text-on-surface-variant', value: '—', hint: FAILED }
}

function healthTile(h: PlatformHealth): Tile {
  const parts: string[] = []
  if (h.db.status === 'online') parts.push(`БД ${h.db.latencyMs} мс`)
  else if (h.db.status === 'degraded') parts.push(`БД отвечает медленно (${h.db.latencyMs} мс)`)
  else parts.push('БД недоступна')
  parts.push(h.missingEnv === 0 ? 'конфигурация полная' : 'конфигурация неполная')
  return {
    label: 'Статус систем',
    icon: h.allOnline ? 'cloud_done' : 'cloud_off',
    color: h.allOnline ? 'text-primary' : 'text-error',
    value: h.allOnline ? 'В норме' : 'Есть сбои',
    hint: parts.join(' · '),
  }
}

export default async function IntelligencePage() {
  const stats = await getIntelligenceStats()

  const tiles: Tile[] = [
    countTile('События аудита', 'hub', 'text-on-surface', stats.auditEvents, 'действия в журнале аудита'),
    countTile('Клиенты', 'groups', 'text-primary', stats.clients, 'профили с ролью «клиент»'),
    stats.aiInsights.ok
      ? {
          label: 'AI Инсайты',
          icon: 'auto_awesome',
          color: 'text-tertiary-container',
          value: String(stats.aiInsights.value.total),
          hint: stats.aiInsights.value.total > 0
            ? `гипотезы ИИ · ждут проверки: ${stats.aiInsights.value.awaitingReview}`
            : 'гипотез ИИ в диагностиках пока нет',
        }
      : { label: 'AI Инсайты', icon: 'auto_awesome', color: 'text-on-surface-variant', value: '—', hint: FAILED },
    healthTile(stats.health),
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Аналитический <span className="text-gradient">центр</span></h1>
          <p className="text-on-surface-variant text-sm mt-1">Сводка платформы: события аудита, клиенты, гипотезы ИИ и состояние систем</p>
        </div>
      </div>

      {/* Signal Stats — real platform counts (lib/intelligence/stats.ts) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className={`material-symbols-outlined text-xl ${stat.color}`} aria-hidden="true">{stat.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
            </div>
            <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-[10px] text-on-surface-variant mt-1">{stat.hint}</p>
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
