'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { UserDetailPanel } from '@/components/giga-panel/UserDetailPanel'
import { ExpertCommentThread } from '@/components/expert/ExpertCommentThread'
import { ExpertCommentsProvider, useExpertComments } from '@/components/expert/ExpertCommentsContext'
import { DashboardTab } from '@/components/expert/tabs/DashboardTab'
import { PointATab } from '@/components/expert/tabs/PointATab'
import { GRITab } from '@/components/expert/tabs/GRITab'
import { PulseTab } from '@/components/expert/tabs/PulseTab'
import { getAvatarGradient, getInitials } from '@/lib/expert-blocks'

interface ExpertClient {
  id: string
  fullName: string | null
  email: string | null
  avatarUrl: string | null
  status: string | null
  createdAt: string | null
  companyName: string | null
  industry: string | null
  stage: string | null
  overallScore: number | null
  healthIndex: number | null
  calculatedAt: string | null
  commentsCount: number
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return 'bg-white/[0.05] text-on-surface-variant border-white/[0.06]'
  if (score < 30) return 'bg-error/10 text-error border-error/20'
  if (score < 60) return 'bg-amber-500/10 text-amber-300 border-amber-500/20'
  return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
}

type TabKey = 'anketa' | 'dashboard' | 'point-a' | 'gri' | 'pulse'

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'anketa',    label: 'Анкета',    icon: 'assignment' },
  { key: 'dashboard', label: 'Дэшборд',   icon: 'dashboard' },
  { key: 'point-a',   label: 'Точка А',   icon: 'radar' },
  { key: 'gri',       label: 'GRI',       icon: 'target' },
  { key: 'pulse',     label: 'Pulse',     icon: 'monitor_heart' },
]

function isValidTab(v: string | null): v is TabKey {
  return v === 'anketa' || v === 'dashboard' || v === 'point-a' || v === 'gri' || v === 'pulse'
}

interface Props {
  params: { id: string }
}

export default function ExpertClientDetailPage({ params }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(
    isValidTab(initialTab) ? initialTab : 'anketa',
  )

  const [client, setClient] = useState<ExpertClient | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    try {
      const res = await fetch('/api/expert/clients')
      if (!res.ok) throw new Error('Не удалось загрузить клиента')
      const json = (await res.json()) as { data?: ExpertClient[] }
      const found = (json.data ?? []).find((c) => c.id === params.id)
      if (!found) {
        setNotFound(true)
      } else {
        setClient(found)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    load()
  }, [load])

  const changeTab = (k: TabKey) => {
    setActiveTab(k)
    const qs = new URLSearchParams(searchParams.toString())
    qs.set('tab', k)
    router.replace(`/expert/clients/${params.id}?${qs.toString()}`, { scroll: false })
  }

  const displayName =
    client?.companyName ?? client?.fullName ?? client?.email ?? 'Клиент'
  const subtitle =
    client?.companyName && client?.fullName
      ? client.fullName
      : client?.email ?? ''

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          href="/expert/clients"
          className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          К списку клиентов
        </Link>
      </header>

      {loading ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] py-20 flex items-center justify-center gap-2 text-on-surface-variant text-sm">
          <span className="material-symbols-outlined text-[18px] animate-spin">
            progress_activity
          </span>
          Загрузка клиента...
        </div>
      ) : notFound || !client ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] border-dashed py-20 text-center">
          <span className="material-symbols-outlined text-[32px] text-on-surface-variant/50">
            person_off
          </span>
          <p className="text-sm text-on-surface-variant mt-2">
            Клиент не найден или недоступен
          </p>
          <Link
            href="/expert/clients"
            className="inline-block mt-3 text-xs text-primary hover:underline"
          >
            Вернуться к списку
          </Link>
        </div>
      ) : (
        <ExpertCommentsProvider clientId={params.id}>
          <HeaderCard client={client} displayName={displayName} subtitle={subtitle} />

          {/* Tabs bar */}
          <nav
            role="tablist"
            className="flex flex-wrap items-center gap-1 rounded-2xl bg-surface-container-low border border-white/[0.04] p-1"
          >
            {TABS.map((t) => {
              const active = activeTab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeTab(t.key)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface border border-transparent'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                  {t.label}
                  <TabCommentBadge tabKey={t.key} />
                </button>
              )
            })}
          </nav>

          {/* Active tab content */}
          <div>
            {activeTab === 'anketa' && (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5">
                <section className="rounded-2xl bg-surface-container-low border border-white/[0.04] overflow-hidden">
                  <div className="px-5 py-3 border-b border-white/[0.04] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary/70">
                      person_search
                    </span>
                    <h2 className="text-sm font-headline font-bold text-on-surface">
                      Данные клиента
                    </h2>
                  </div>
                  <UserDetailPanel userId={params.id} readOnly />
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">
                      forum
                    </span>
                    <h2 className="text-sm font-headline font-bold text-on-surface">
                      Общие комментарии
                    </h2>
                  </div>
                  <ExpertCommentThread clientId={params.id} />
                </section>
              </div>
            )}

            {activeTab === 'dashboard' && <DashboardTab clientId={params.id} />}
            {activeTab === 'point-a'   && <PointATab   clientId={params.id} />}
            {activeTab === 'gri'       && <GRITab      clientId={params.id} />}
            {activeTab === 'pulse'     && <PulseTab    clientId={params.id} />}
          </div>
        </ExpertCommentsProvider>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HeaderCard({
  client,
  displayName,
  subtitle,
}: {
  client: ExpertClient
  displayName: string
  subtitle: string
}) {
  const { allComments } = useExpertComments()
  const liveCount = allComments.length

  return (
    <section className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-5">
      <div className="flex items-start gap-4 flex-wrap">
        {client.avatarUrl ? (
          <img
            src={client.avatarUrl}
            alt={displayName}
            className="w-16 h-16 rounded-2xl border border-white/[0.08] object-cover flex-shrink-0"
          />
        ) : (
          <div
            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${getAvatarGradient(client.id)} border border-white/[0.08] flex items-center justify-center text-xl font-bold text-on-surface flex-shrink-0`}
          >
            {getInitials(displayName)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70 mb-1">
            Клиент
          </p>
          <h1 className="font-headline text-2xl font-bold text-on-surface truncate">
            {displayName}
          </h1>
          {subtitle && (
            <p className="text-sm text-on-surface-variant truncate mt-0.5">{subtitle}</p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {client.industry && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.06] text-on-surface-variant">
                {client.industry}
              </span>
            )}
            {client.stage && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300">
                {client.stage}
              </span>
            )}
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">forum</span>
              {liveCount} коммент.
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/70">
            Overall Score
          </span>
          <span
            className={`text-sm font-bold px-3 py-1.5 rounded-xl border ${scoreBadgeClass(client.overallScore)}`}
          >
            {client.overallScore ?? '—'}
          </span>
          {client.healthIndex !== null && (
            <span className="text-[10px] text-on-surface-variant mt-1">
              Health: {client.healthIndex}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

/** Small badge on each tab showing how many comments fall into that tab's group */
function TabCommentBadge({ tabKey }: { tabKey: TabKey }) {
  const { allComments } = useExpertComments()

  // Match tab → target group prefix (see lib/comment-targets.ts)
  let count = 0
  for (const c of allComments) {
    if (!c.blockKey) {
      if (tabKey === 'anketa') count++
      continue
    }
    if (tabKey === 'dashboard' && c.blockKey.startsWith('dashboard:')) count++
    else if (tabKey === 'gri' && c.blockKey.startsWith('gri:')) count++
    else if (tabKey === 'pulse' && c.blockKey.startsWith('pulse:')) count++
    else if (
      tabKey === 'point-a' &&
      ['finance', 'sales', 'operations', 'marketing', 'strategy'].includes(c.blockKey)
    )
      count++
  }

  if (count === 0) return null
  return (
    <span className="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.08] text-on-surface-variant">
      {count}
    </span>
  )
}
