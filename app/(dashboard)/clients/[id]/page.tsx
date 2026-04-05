import type { Metadata } from 'next'
import Link from 'next/link'
import { GriScoreDial } from '@/components/gri/GriScoreDial'
import { StatusBadge } from '@/components/common/StatusBadge'
import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import type { BlockScore, Risk, Insight, QuickWin } from '@/types/onboarding'
import ChocoDashboard from '@/components/choco/dashboard'

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

async function fetchPrismaClient(id: string) {
  try {
    return await prisma.client.findUnique({ where: { id } })
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
    const isChocoFamily = displayName.toLowerCase().includes('choco') || params.id === '7'
    const griScore = diag?.overall_score != null ? Math.round(diag.overall_score) / 10 : 0

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
        {!isChocoFamily && (
          <div className="flex gap-1 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
            {['Point A', 'Риски', 'Инсайты', 'Быстрые победы'].map((tab, i) => (
              <button key={tab} className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${i === 0 ? 'text-primary border-primary' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}>{tab}</button>
            ))}
          </div>
        )}

        {isChocoFamily ? (
          <div className="mt-8 rounded-3xl overflow-hidden shadow-2xl border border-white/5 bg-[#111111]">
            <ChocoDashboard />
          </div>
        ) : diag ? (
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

<<<<<<< HEAD
  // ── Prisma client fallback ────────────────────────────────────────────────
  const prismaClient = await fetchPrismaClient(params.id)

  if (prismaClient) {
    const stageLabel: Record<string, string> = { Seed: 'Seed', Early: 'Early', Growth: 'Growth', Scale: 'Scale', Mature: 'Mature' }
    const statusLabel: Record<string, string> = { active: 'Активный', at_risk: 'Под риском', inactive: 'Неактивный', onboarding: 'Онбординг' }
    const isChocoFamily = prismaClient.name.toLowerCase().includes('choco') || params.id === '7'
    
    return (
      <div className="space-y-6">
        <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Link href="/clients" className="hover:text-on-surface transition-colors">Clients</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface">{prismaClient.name}</span>
        </nav>

        <div className="flex flex-col lg:flex-row items-start gap-6">
          <div className="w-16 h-16 rounded-2xl bg-surface-container-high flex items-center justify-center text-2xl font-headline font-bold text-primary flex-shrink-0">
            {prismaClient.name[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
              <h1 className="font-headline text-3xl font-bold text-on-surface">{prismaClient.name}</h1>
              <StatusBadge status={prismaClient.status as 'active'} label={statusLabel[prismaClient.status] ?? prismaClient.status} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
              <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">business</span>{prismaClient.industry}</span>
              <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">trending_up</span>{stageLabel[prismaClient.stage] ?? prismaClient.stage}</span>
              {prismaClient.website && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">link</span>{prismaClient.website}</span>}
              {prismaClient.sector && <span className="flex items-center gap-1.5"><span className="material-symbols-outlined text-base">category</span>{prismaClient.sector}</span>}
            </div>
          </div>
        </div>

        {isChocoFamily ? (
          <div className="mt-8 rounded-3xl overflow-hidden shadow-2xl border border-white/5 bg-[#111111]">
            <ChocoDashboard />
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

  // ── Client Not Found ──────────────────────────────────────────────────────
=======
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/clients" className="hover:text-on-surface transition-colors">Clients</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
<<<<<<< HEAD
        <span className="text-on-surface">Не найден</span>
      </nav>
      <div className="bg-surface-container rounded-xl p-12 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-4 block">person_off</span>
        <p className="text-on-surface font-medium mb-2">Клиент не найден</p>
        <p className="text-sm text-on-surface-variant mb-6">Профиль с указанным ID не существует или был удалён</p>
        <Link href="/clients" className="inline-flex items-center gap-2 text-sm font-mono text-primary hover:underline">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Вернуться к списку клиентов
=======
        <span className="text-on-surface">Нет данных</span>
      </nav>

      <div className="bg-surface-container rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">database_off</span>
        <p className="text-on-surface font-medium mb-1">Профиль клиента не найден</p>
        <p className="text-sm text-on-surface-variant mb-4">Для этого клиента пока нет данных диагностики в базе.</p>
        <Link href="/clients" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-outline-variant/30 text-sm hover:bg-surface-container-high transition-colors">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Вернуться к списку
>>>>>>> 41f51555aefe4444f42b51d039ecb8f312ab4ace
        </Link>
      </div>
    </div>
  )
}
