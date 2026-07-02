import type { Metadata } from 'next'
import Link from 'next/link'
import { GriScoreDial } from '@/components/gri/GriScoreDial'
import { StatusBadge } from '@/components/common/StatusBadge'
import { createServerClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/db'
import type { BlockScore, Risk, Insight, QuickWin } from '@/types/onboarding'

export const metadata: Metadata = { title: 'Профиль клиента | Админ' }

async function fetchClientData(id: string) {
  // Use Prisma as the primary source for modern clients
  try {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        manager: true,
        griReports: {
          orderBy: { calculatedAt: 'desc' },
          take: 1
        }
      }
    })
    
    if (client) return { type: 'prisma', data: client }

    // Fallback to Supabase for legacy profiles
    const sb = createServerClient()
    const { data: profile } = await sb.from('profiles').select('*').eq('id', id).single()
    if (profile) {
      const { data: company } = await sb.from('companies').select('*').eq('user_id', id).maybeSingle()
      const { data: diagnostic } = await sb.from('diagnostics').select('*').eq('user_id', id).eq('is_current', true).maybeSingle()
      return { type: 'supabase', data: { profile, company, diagnostic } }
    }
    
    return null
  } catch (error) {
    console.error('Error fetching client data:', error)
    return null
  }
}

// Helper formatting functions
function blockLabel(key: string) { return { finance:'Финансы', sales:'Продажи', operations:'Операции', marketing:'Маркетинг', strategy:'Стратегия' }[key] ?? key }
function blockIcon(key: string) { return { finance:'account_balance', sales:'shopping_cart', operations:'settings', marketing:'campaign', strategy:'flag' }[key] ?? 'analytics' }
function scoreColor(s: number) { return s >= 80 ? 'text-primary' : s >= 60 ? 'text-tertiary-container' : 'text-error' }
function barColor(s: number) { return s >= 80 ? 'bg-primary' : s >= 60 ? 'bg-tertiary-container' : 'bg-error' }

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const result = await fetchClientData(params.id)

  if (!result) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
        <div className="w-20 h-20 rounded-3xl bg-surface-container flex items-center justify-center mb-6 border border-white/[0.04]">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/30">person_off</span>
        </div>
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Клиент не найден</h1>
        <p className="text-on-surface-variant text-sm mb-8 max-w-sm">
          Профиль с ID <code className="bg-surface-container px-1.5 py-0.5 rounded text-primary font-mono">{params.id}</code> не существует или был удален из базы данных.
        </p>
        <Link href="/clients" className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-xl font-bold hover:scale-[0.98] transition-all shadow-primary-sm">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Вернуться к списку
        </Link>
      </div>
    )
  }

  const name = result.type === 'prisma' 
    ? (result.data as any).name 
    : (result.data as any).company?.name ?? (result.data as any).profile?.full_name ?? 'Клиент'

  // Common UI variables
  const data = result.data as any
  const status = result.type === 'prisma' ? data.status : data.profile.status
  const industry = result.type === 'prisma' ? data.industry : data.company?.industry
  const stage = result.type === 'prisma' ? data.stage : data.company?.stage
  const griReport = result.type === 'prisma' ? data.griReports?.[0] : data.diagnostic
  
  const overallScore = griReport 
    ? (result.type === 'prisma' ? griReport.score / 10 : griReport.overall_score / 10)
    : 0

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header & Nav */}
      <div className="space-y-6">
        <nav className="flex items-center gap-2 text-xs font-mono text-on-surface-variant uppercase tracking-widest">
          <Link href="/clients" className="hover:text-primary transition-colors">Клиенты</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-on-surface font-bold">{name}</span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-surface-container-high to-surface-container flex items-center justify-center text-2xl font-headline font-bold text-primary border border-white/[0.04] shadow-xl">
              {name[0].toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="font-headline text-3xl font-extrabold text-on-surface">{name}</h1>
                <StatusBadge status={status === 'active' || status === 'approved' ? 'success' : 'warning'} label={status} />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                <span className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded-md border border-white/[0.02]"><span className="material-symbols-outlined text-sm text-primary">business</span>{industry ?? 'N/A'}</span>
                <span className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded-md border border-white/[0.02]"><span className="material-symbols-outlined text-sm text-primary">trending_up</span>{stage ?? 'N/A'}</span>
                <span className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded-md border border-white/[0.02]"><span className="material-symbols-outlined text-sm text-primary">id_card</span>ID: {params.id}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-5 py-2.5 bg-surface-container-low border border-white/[0.04] text-on-surface text-sm font-bold rounded-xl hover:bg-surface-container transition-colors">
              Архив отчетов
            </button>
            <button className="px-5 py-2.5 bg-primary text-on-primary text-sm font-bold rounded-xl shadow-primary-sm hover:scale-[0.98] transition-all">
              Запустить GRI
            </button>
          </div>
        </div>
      </div>

      {griReport ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Score */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-8 shadow-sm">
               <GriScoreDial score={overallScore} label="Current GRI Score" />
               <div className="mt-8 space-y-4">
                 <div className="flex justify-between items-center text-xs font-mono uppercase tracking-widest text-on-surface-variant">
                   <span>Дата последнего GRI</span>
                   <span className="text-on-surface font-bold">
                     {new Date(griReport.calculatedAt || griReport.calculated_at).toLocaleDateString('ru-RU')}
                   </span>
                 </div>
                 <div className="h-px bg-white/[0.04]" />
                 <p className="text-xs text-on-surface-variant leading-relaxed italic">
                   "Судя по последним данным, компания находится в фазе {stage ?? 'активного развития'}. Основной фокус — оптимизация операционных процессов."
                 </p>
               </div>
            </div>
          </div>

          {/* Details */}
          <div className="lg:col-span-8 space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               {[
                 { key: 'finance', val: griReport.cashScore ?? (griReport.finance_score?.score) },
                 { key: 'operations', val: griReport.operationsScore ?? (griReport.operations_score?.score) },
                 { key: 'team', val: griReport.teamScore ?? (griReport.strategy_score?.score) }, // Simple mapping
                 { key: 'marketing', val: (griReport.marketing_score?.score) ?? 0 }
               ].map((block) => {
                 const score = block.val ?? 0
                 return (
                   <div key={block.key} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
                     <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                           <span className="material-symbols-outlined text-primary text-lg">{blockIcon(block.key)}</span>
                           <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">{blockLabel(block.key)}</h3>
                        </div>
                        <span className={`text-2xl font-mono font-bold ${scoreColor(score)}`}>{score}</span>
                     </div>
                     <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
                        <div className={`h-full rounded-full transition-all duration-1000 ${barColor(score)}`} style={{ width: `${score}%` }} />
                     </div>
                   </div>
                 )
               })}
             </div>

             {/* Risks Section */}
             {(griReport.risks as any)?.length > 0 && (
               <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
                  <h3 className="font-headline font-bold text-on-surface mb-5 flex items-center gap-2">
                    <span className="material-symbols-outlined text-error text-xl">warning</span>
                    Критические риски
                  </h3>
                  <div className="space-y-3 font-mono">
                    {(griReport.risks as any).slice(0, 3).map((risk: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-surface-container rounded-xl border border-white/[0.02]">
                        <span className="text-xs text-on-surface truncate pr-4">{risk.text || risk}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-error/10 text-error border border-error/20 uppercase font-bold">High</span>
                      </div>
                    ))}
                  </div>
               </div>
             )}
          </div>
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-16 text-center shadow-sm">
          <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center mx-auto mb-6 border border-white/[0.04]">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/20">query_stats</span>
          </div>
          <h2 className="font-headline text-2xl font-bold text-on-surface mb-2">Данные GRI отсутствуют</h2>
          <p className="text-sm text-on-surface-variant mb-8 max-w-sm mx-auto">
            Для этого клиента еще не проводилась диагностика Точки А. Нажмите кнопку выше, чтобы запустить AI-анализ.
          </p>
        </div>
      )}
    </div>
  )
}
