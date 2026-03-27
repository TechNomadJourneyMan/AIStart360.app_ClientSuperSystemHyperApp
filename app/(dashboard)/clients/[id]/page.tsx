import type { Metadata } from 'next'
import Link from 'next/link'
import { GriScoreDial } from '@/components/gri/GriScoreDial'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MOCK_CLIENTS } from '@/lib/mock-data'
import { createServerClient } from '@/lib/supabase-server'
import type { BlockScore, Risk, Insight, QuickWin } from '@/types/onboarding'

export const metadata: Metadata = { title: 'Client Profile' }

async function fetchClientData(id: string) {
  try {
    const sb = createServerClient()
    const [profileRes, companyRes, diagRes] = await Promise.all([
      sb.from('profiles').select('*').eq('id', id).single(),
      sb.from('companies').select('*').eq('user_id', id).maybeSingle(),
      sb.from('diagnostics').select('*').eq('user_id', id).eq('is_current', true).maybeSingle(),
    ])
    if (profileRes.error) return null
    return { profile: profileRes.data, company: companyRes.data, diagnostic: diagRes.data }
  } catch {
    return null
  }
}

function blockLabel(key: string) { return { finance:'Финансы', sales:'Продажи', operations:'Операции', marketing:'Маркетинг', strategy:'Стратегия' }[key] ?? key }
function blockWeight(key: string) { return { finance:'30%', sales:'25%', operations:'20%', marketing:'15%', strategy:'10%' }[key] ?? '' }
function blockIcon(key: string) { return { finance:'account_balance', sales:'shopping_cart', operations:'settings', marketing:'campaign', strategy:'flag' }[key] ?? 'analytics' }

function scoreColor(s: number) { return s >= 80 ? 'text-primary' : s >= 70 ? 'text-primary-fixed-dim' : s >= 50 ? 'text-tertiary-container' : 'text-error' }
function barColor(s: number) { return s >= 80 ? 'bg-primary' : s >= 70 ? 'bg-primary-fixed-dim' : s >= 50 ? 'bg-tertiary-container' : 'bg-error' }
function statusColor(s: string) {
  return { excellent:'text-primary border-primary/30 bg-primary/10', strong:'text-primary-fixed-dim border-primary-fixed-dim/30 bg-primary-fixed-dim/10', average:'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10', weak:'text-error/80 border-error/20 bg-error/10', critical:'text-error border-error/30 bg-error/10' }[s] ?? 'text-on-surface-variant border-outline-variant bg-surface-container'
}
function riskIcon(l: string) { return l === 'critical' ? 'error' : l === 'high' ? 'warning' : 'info' }
function riskColor(l: string) { return l === 'critical' ? 'text-error' : l === 'high' ? 'text-tertiary-container' : 'text-on-surface-variant' }
function statusPhrase(s: string) { return { pending_approval:'Ожидает', approved:'Активный', requires_clarification:'Уточнение', rejected:'Отклонён' }[s] ?? s }

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const realData = await fetchClientData(params.id)

  // ── Real Supabase client ──────────────────────────────────────────────────
  if (realData) {
    const { profile, company, diagnostic: diag } = realData
    const displayName = company?.name ?? profile?.full_name ?? profile?.email ?? 'Клиент'
    const griScore = diag?.overall_score != null ? Math.round(diag.overall_score * 10) : 0

    const blocks: Array<{ key: string; data: BlockScore | null }> = [
      { key: 'finance',    data: diag?.finance_score    as BlockScore | null },
      { key: 'sales',      data: diag?.sales_score      as BlockScore | null },
      { key: 'operations', data: diag?.operations_score as BlockScore | null },
      { key: 'marketing',  data: diag?.marketing_score  as BlockScore | null },
      { key: 'strategy',   data: diag?.strategy_score   as BlockScore | null },
    ]
    const risks      = (diag?.risks       as Risk[]      | null) ?? []
    const insights   = (diag?.insights    as Insight[]   | null) ?? []
    const quickWins  = (diag?.quick_wins  as QuickWin[]  | null) ?? []

    return (
      <div className="space-y-6">
        <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Link href="/clients" className="hover:text-on-surface transition-colors">Clients</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface">{displayName}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <div className="w-16 h-16 rounded-2xl bg-surface-container-high flex items-center justify-center text-2xl font-headline font-bold text-primary flex-shrink-0">
            {displayName[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
              <h1 className="font-headline text-3xl font-bold text-on-surface">{displayName}</h1>
              {profile && <StatusBadge status={profile.status as 'active'} label={statusPhrase(profile.status)} />}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
              {company?.industry && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">business</span>{company.industry}</span>}
              {company?.stage && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">trending_up</span>{company.stage}</span>}
              {profile?.email && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">mail</span>{profile.email}</span>}
              {diag?.calculated_at && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">update</span>Диагностика: {new Date(diag.calculated_at).toLocaleDateString('ru-RU')}</span>}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
          {['Point A', 'Риски', 'Инсайты', 'Быстрые победы'].map((tab, i) => (
            <button key={tab} className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${i === 0 ? 'text-primary border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}>{tab}</button>
          ))}
        </div>

        {diag ? (
          <div className="space-y-6">
            {/* Score + Blocks */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <GriScoreDial score={griScore} label="Point A Score" />
              </div>
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {blocks.map(({ key, data }) => (
                  <div key={key} className="bg-surface-container-low rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-on-surface-variant text-base">{blockIcon(key)}</span>
                        <p className="text-sm font-medium text-on-surface">{blockLabel(key)}</p>
                      </div>
                      <span className="text-[10px] font-mono text-on-surface-variant">{blockWeight(key)}</span>
                    </div>
                    {data ? (
                      <>
                        <div className="flex items-end gap-2 mb-2">
                          <p className={`text-3xl font-mono font-bold ${scoreColor(data.score)}`}>{data.score}</p>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border mb-1 ${statusColor(data.status)}`}>{data.status}</span>
                        </div>
                        <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden mb-3">
                          <div className={`h-full rounded-full ${barColor(data.score)}`} style={{ width: `${data.score}%` }} />
                        </div>
                        {data.top_issues.slice(0, 2).map((issue, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-on-surface-variant mb-1">
                            <span className="material-symbols-outlined text-error text-xs mt-0.5 flex-shrink-0">remove_circle</span>
                            {issue}
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="text-sm text-on-surface-variant">Нет данных</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Risks */}
            {risks.length > 0 && (
              <div className="bg-surface-container rounded-xl p-6">
                <h3 className="font-headline text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-error">warning</span>
                  Риски ({risks.length})
                </h3>
                <div className="space-y-3">
                  {risks.map((risk, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-lg">
                      <span className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${riskColor(risk.level)}`}>{riskIcon(risk.level)}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-on-surface">{risk.area}</p>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${riskColor(risk.level)} border-current/20`}>{risk.level}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant">{risk.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Insights + Quick Wins */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {insights.length > 0 && (
                <div className="bg-surface-container rounded-xl p-6">
                  <h3 className="font-headline text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">lightbulb</span>
                    Инсайты
                  </h3>
                  <div className="space-y-3">
                    {insights.map((insight, i) => (
                      <div key={i} className="p-3 bg-surface-container-low rounded-lg">
                        <p className="text-sm font-medium text-on-surface mb-1">{insight.area}</p>
                        <p className="text-xs text-on-surface-variant">{insight.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {quickWins.length > 0 && (
                <div className="bg-surface-container rounded-xl p-6">
                  <h3 className="font-headline text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">bolt</span>
                    Быстрые победы
                  </h3>
                  <div className="space-y-3">
                    {quickWins.map((win, i) => (
                      <div key={i} className="p-3 bg-surface-container-low rounded-lg flex items-start gap-3">
                        <span className="text-[10px] font-mono px-2 py-1 bg-primary/10 text-primary rounded-lg flex-shrink-0 mt-0.5">{win.timeline}</span>
                        <div>
                          <p className="text-sm font-medium text-on-surface mb-0.5">{win.action}</p>
                          <p className="text-xs text-on-surface-variant">{win.area}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-surface-container rounded-xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">hourglass_top</span>
            <p className="text-on-surface font-medium mb-1">Диагностика ожидается</p>
            <p className="text-sm text-on-surface-variant">Клиент ещё не завершил анкетирование или не запустил расчёт Point A</p>
          </div>
        )}
      </div>
    )
  }

  // ── Fallback: mock ──────────────────────────────────────────────────────────
  const client = MOCK_CLIENTS.find((c) => c.id === params.id) ?? MOCK_CLIENTS[0]

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/clients" className="hover:text-on-surface transition-colors">Clients</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface">{client.name}</span>
      </nav>

      <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-high rounded-lg border border-outline-variant/20 w-fit">
        <span className="material-symbols-outlined text-sm text-on-surface-variant">info</span>
        <span className="text-xs font-mono text-on-surface-variant">Demo-данные</span>
      </div>

      <div className="flex flex-col lg:flex-row items-start gap-6">
        <div className="w-16 h-16 rounded-2xl bg-surface-container-high flex items-center justify-center text-2xl font-headline font-bold text-primary flex-shrink-0">
          {client.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
            <h1 className="font-headline text-3xl font-bold text-on-surface">{client.name}</h1>
            <StatusBadge status={client.status} label={client.status} />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">business</span>{client.industry}</span>
            <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">trending_up</span>{client.stage}</span>
            <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">person</span>{client.manager}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className="inline-flex items-center gap-2 px-4 py-2 border border-outline-variant/30 rounded-lg text-sm text-on-surface hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-lg">edit</span>
            Редактировать
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg hover:scale-[0.98] transition-all">
            <span className="material-symbols-outlined text-lg">description</span>
            Run Report
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
        {['Overview', 'GRI Report', 'Growth Plan', 'Reports', 'Activity'].map((tab, i) => (
          <button key={tab} className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${i === 0 ? 'text-primary border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/50'}`}>{tab}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <GriScoreDial score={client.griScore} previousScore={client.previousGriScore} />
        </div>
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'LTV/CAC', value: '4.82x', icon: 'currency_exchange', trend: '+0.15' },
            { label: 'GMV', value: '$340K', icon: 'payments', trend: '+8.4%' },
            { label: 'Growth Rate', value: '22%', icon: 'trending_up', trend: '+3%' },
            { label: 'NPS Score', value: '67', icon: 'star', trend: '+5' },
            { label: 'Engagement', value: '8.4/10', icon: 'bar_chart', trend: '+0.6' },
            { label: 'Risk Score', value: 'Low', icon: 'shield_check', trend: '' },
          ].map((metric) => (
            <div key={metric.label} className="bg-surface-container-low p-4 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-on-surface-variant text-base">{metric.icon}</span>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{metric.label}</p>
              </div>
              <p className="text-xl font-mono font-bold text-on-surface">{metric.value}</p>
              {metric.trend && <p className="text-xs font-mono text-primary mt-1">{metric.trend}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-container rounded-xl p-6">
        <h3 className="font-headline text-lg font-bold text-on-surface mb-5">GRI Domain Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { domain: 'Strategy & Vision', score: 840, weight: '20%' },
            { domain: 'Financial Health',  score: 760, weight: '20%' },
            { domain: 'Operations',        score: 820, weight: '15%' },
            { domain: 'Team & Talent',     score: 710, weight: '15%' },
            { domain: 'Market Position',   score: 780, weight: '15%' },
            { domain: 'Technology',        score: 690, weight: '15%' },
          ].map((item) => {
            const pct = Math.round(item.score / 10)
            const color = item.score >= 800 ? 'bg-primary' : item.score >= 700 ? 'bg-primary-fixed-dim' : 'bg-tertiary-container'
            return (
              <div key={item.domain} className="bg-surface-container-high rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-sm font-medium text-on-surface">{item.domain}</p>
                  <span className="text-[10px] font-mono text-on-surface-variant">{item.weight}</span>
                </div>
                <p className="text-2xl font-mono font-bold text-on-surface mb-2">{item.score}</p>
                <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
