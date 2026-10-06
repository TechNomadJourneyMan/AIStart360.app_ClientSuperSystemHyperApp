'use client'

/**
 * «Стоимость ИИ» — spend and tokens by day, agent, model and company for
 * 7 / 30 / 90 days (GET /api/giga-admin/agents/costs), today's spend against
 * the platform daily budget, and per-agent daily budgets from the agents list.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Coins, Cpu, RefreshCw, Wallet, Zap } from 'lucide-react'
import { RequirePermission } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { Button, DataTable, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatTile, cx, useGigaQuery, type Column } from '../kit'
import { CostChart } from './CostChart'
import { budgetUsage, fillDailySeries, fmtTokens, fmtUsd, shareOf, spendOn, toNum, totalsOf } from './model'
import type { CostsResponse } from './types'
import { useAgentDirectory } from './useAgentDirectory'
import { Segmented } from './ui'

type Period = '7' | '30' | '90'
const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' },
]

interface AgentCostRow { key: string; cost: number; runs: number; llm: number; tin: number; tout: number }
interface ModelCostRow { model: string; cost: number; runs: number; tin: number; tout: number }
interface CompanyCostRow { id: string; name: string | null; cost: number; runs: number }

export function AgentCostsPage() {
  const { base } = useWorkspace()
  const [period, setPeriod] = useState<Period>('30')
  const q = useGigaQuery<CostsResponse>(`/api/giga-admin/agents/costs?days=${period}`)
  const dir = useAgentDirectory()
  const d = q.data

  const series = useMemo(() => (d ? fillDailySeries(d.byDay, Number(period)) : []), [d, period])
  const totals = totalsOf(series)
  const today = spendOn(series)
  const platform = budgetUsage(today, d?.budgets.platformDailyUsd)

  const byAgent: AgentCostRow[] = useMemo(() => (d?.byAgent ?? []).map((r) => ({
    key: String(r.agent_key ?? '—'), cost: toNum(r.cost), runs: toNum(r.runs), llm: toNum(r.llm_calls), tin: toNum(r.tin), tout: toNum(r.tout),
  })), [d])
  const byModel: ModelCostRow[] = useMemo(() => (d?.byModel ?? []).map((r) => ({
    model: String(r.model ?? '—'), cost: toNum(r.cost), runs: toNum(r.runs), tin: toNum(r.tin), tout: toNum(r.tout),
  })), [d])
  const byCompany: CompanyCostRow[] = useMemo(() => (d?.byCompany ?? []).map((r) => ({
    id: String(r.company_id ?? '—'), name: typeof r.company_name === 'string' ? r.company_name : null, cost: toNum(r.cost), runs: toNum(r.runs),
  })), [d])

  const agentCols: Column<AgentCostRow>[] = [
    { key: 'agent', header: 'Агент', render: (r) => <Link href={`${base}/agents/${encodeURIComponent(r.key)}`} className="text-slate-200 hover:text-blue-200">{dir.names[r.key] ?? <span className="font-mono text-[11px]">{r.key}</span>}</Link> },
    { key: 'runs', header: 'Запусков', className: 'text-right', render: (r) => <Num>{r.runs.toLocaleString('ru-RU')}</Num> },
    { key: 'llm', header: 'Вызовов LLM', className: 'text-right', render: (r) => <Num>{r.llm.toLocaleString('ru-RU')}</Num> },
    { key: 'tokens', header: 'Токены вх / вых', className: 'text-right', render: (r) => <Num>{fmtTokens(r.tin)} / {fmtTokens(r.tout)}</Num> },
    { key: 'cost', header: 'Стоимость', className: 'text-right', render: (r) => <Num strong>{fmtUsd(r.cost)}</Num> },
    { key: 'share', header: 'Доля', className: 'text-right', render: (r) => <Num>{shareOf(r.cost, totals.cost)}</Num> },
  ]
  const modelCols: Column<ModelCostRow>[] = [
    { key: 'model', header: 'Модель', render: (r) => <span className="font-mono text-[11px] text-slate-200">{r.model}</span> },
    { key: 'runs', header: 'Запусков', className: 'text-right', render: (r) => <Num>{r.runs.toLocaleString('ru-RU')}</Num> },
    { key: 'tokens', header: 'Токены вх / вых', className: 'text-right', render: (r) => <Num>{fmtTokens(r.tin)} / {fmtTokens(r.tout)}</Num> },
    { key: 'cost', header: 'Стоимость', className: 'text-right', render: (r) => <Num strong>{fmtUsd(r.cost)}</Num> },
    { key: 'share', header: 'Доля', className: 'text-right', render: (r) => <Num>{shareOf(r.cost, totals.cost)}</Num> },
  ]
  const companyCols: Column<CompanyCostRow>[] = [
    { key: 'company', header: 'Компания', render: (r) => <span className="text-slate-200">{r.name || <span className="font-mono text-[11px]">{r.id}</span>}</span> },
    { key: 'runs', header: 'Запусков', className: 'text-right', render: (r) => <Num>{r.runs.toLocaleString('ru-RU')}</Num> },
    { key: 'cost', header: 'Стоимость', className: 'text-right', render: (r) => <Num strong>{fmtUsd(r.cost)}</Num> },
    { key: 'share', header: 'Доля', className: 'text-right', render: (r) => <Num>{shareOf(r.cost, totals.cost)}</Num> },
    { key: 'tasks', header: '', render: (r) => <Link href={`${base}/agents/tasks?company=${encodeURIComponent(r.id)}${r.name ? `&cname=${encodeURIComponent(r.name)}` : ''}`} className="text-[11px] text-blue-300 hover:underline">задачи</Link> },
  ]

  // Since 094 the budgets can be set in the panel; the API says where each value comes from.
  const sources = (d?.budgets ?? {}) as { platformSource?: 'db' | 'env'; companySource?: 'db' | 'env' }
  const agentBudgets = (dir.agents ?? []).filter((a) => a.limits.dailyBudgetUsd > 0 || a.stats.costUsdToday > 0)

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты', href: `${base}/agents` }, { label: 'Стоимость ИИ' }]}
        title="Стоимость ИИ"
        description="Фактическая стоимость запусков агентов (по данным провайдеров): по дням, агентам, моделям и компаниям. Сутки — по UTC. Расходы по провайдерам и функциям — в разделе «Провайдеры и ключи»."
        actions={
          <>
            <Segmented label="Период" value={period} options={PERIODS} onChange={setPeriod} />
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!d} onClick={() => void q.reload()}>Обновить</Button>
          </>
        }
      />

      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}
      {!d && q.loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      )}

      {d && (
        <div className={cx('space-y-4', q.loading && 'opacity-70 transition-opacity')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`Расход за ${period} дн.`} value={fmtUsd(totals.cost)} hint={totals.runs ? `в среднем ${fmtUsd(totals.cost / totals.runs)} за запуск` : 'запусков не было'} icon={<Coins size={14} />} />
            <StatTile label="Запусков" value={totals.runs.toLocaleString('ru-RU')} icon={<Zap size={14} />} tone="violet" />
            <StatTile label="Токены" value={fmtTokens(totals.tokensIn + totals.tokensOut)} hint={`вх. ${fmtTokens(totals.tokensIn)} · вых. ${fmtTokens(totals.tokensOut)}`} icon={<Cpu size={14} />} tone="neutral" />
            <StatTile
              label="Сегодня (UTC)"
              value={fmtUsd(today)}
              hint={platform ? `${platform.label} дневного бюджета платформы` : 'бюджет платформы не задан'}
              icon={<Wallet size={14} />}
              tone={platform?.tone ?? 'neutral'}
            />
          </div>

          <Panel title="Расход по дням">
            {totals.runs === 0 && totals.cost === 0
              ? <EmptyState icon={<Coins size={18} />} title="За период запусков не было" text="Когда агенты начнут работать, здесь появится расход по дням." />
              : <CostChart points={series} />}
          </Panel>

          <Panel title="Бюджеты на сегодня" description="Суточные лимиты. Запуск, который превысил бы лимит, останавливается с ошибкой BUDGET_EXCEEDED, задача уходит в dead-letter — её можно повторить позже.">
            <BudgetBar label="Платформа" spent={today} budget={d.budgets.platformDailyUsd} note={budgetNote(sources.platformSource, 'AGENT_PLATFORM_DAILY_BUDGET_USD')} />
            <p className="mt-3 text-[11px] text-slate-500">
              Бюджет одной компании в сутки: <span className="font-mono text-slate-300">{fmtUsd(d.budgets.companyDailyUsd)}</span>
              <span className="ml-1 font-mono text-[10px] text-slate-600">{budgetNote(sources.companySource, 'AGENT_COMPANY_DAILY_BUDGET_USD')}</span>.
              Сверх него задачи этой компании останавливаются с BUDGET_EXCEEDED.
              {' '}Изменить бюджеты платформы, компании и провайдеров — <Link href={`${base}/ai-providers`} className="text-blue-300 hover:underline">«Провайдеры и ключи»</Link>.
            </p>
            {agentBudgets.length > 0 && (
              <div className="mt-4 border-t border-white/[0.05] pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Агенты</p>
                <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                  {agentBudgets.map((a) => (
                    <BudgetBar key={a.key} label={a.name} spent={a.stats.costUsdToday} budget={a.limits.dailyBudgetUsd} href={`${base}/agents/${encodeURIComponent(a.key)}?tab=settings`} />
                  ))}
                </div>
              </div>
            )}
            {dir.error && <p className="mt-3 text-[11px] text-slate-500">Бюджеты агентов не загрузились: {dir.error.message}</p>}
          </Panel>

          <Panel title="По моделям" bodyClassName="p-0">
            <DataTable columns={modelCols} rows={byModel} rowKey={(r) => r.model} empty={<EmptyState title="Вызовов моделей не было" text="Детерминированные агенты работают без LLM и сюда не попадают." />} />
          </Panel>

          <Panel title="По агентам" bodyClassName="p-0">
            <DataTable columns={agentCols} rows={byAgent} rowKey={(r) => r.key} empty={<EmptyState title="Запусков за период не было" />} />
          </Panel>

          <Panel title="По компаниям" description="Топ-50 компаний по расходу за период." bodyClassName="p-0">
            <DataTable columns={companyCols} rows={byCompany} rowKey={(r) => r.id} empty={<EmptyState title="Нет расходов по компаниям" text="Платформенные агенты (мониторинг) работают без компании и сюда не попадают." />} />
          </Panel>
        </div>
      )}
    </RequirePermission>
  )
}

function budgetNote(source: 'db' | 'env' | undefined, envName: string): string {
  return source === 'db' ? 'задано в панели' : envName
}

function Num({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <span className={cx('font-mono tabular-nums', strong ? 'text-slate-100' : 'text-slate-300')}>{children}</span>
}

function BudgetBar({ label, spent, budget, note, href }: { label: string; spent: number; budget: number; note?: string; href?: string }) {
  const usage = budgetUsage(spent, budget)
  const bar = { green: 'bg-emerald-400/70', amber: 'bg-amber-400/80', red: 'bg-red-400/80' } as Record<string, string>
  const title = href ? <Link href={href} className="hover:text-blue-200">{label}</Link> : label
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-slate-200">{title}{note && <span className="ml-1.5 font-mono text-[10px] text-slate-600">{note}</span>}</span>
        <span className="shrink-0 font-mono tabular-nums text-slate-300">
          {fmtUsd(spent)} <span className="text-slate-500">/ {budget > 0 ? fmtUsd(budget) : 'без лимита'}</span>
        </span>
      </div>
      {usage ? (
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.05]"
          role="progressbar"
          aria-label={`${label}: израсходовано ${usage.label} бюджета`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(usage.ratio * 100))}
        >
          <div className={cx('h-full rounded-full', bar[usage.tone] ?? 'bg-blue-400/70')} style={{ width: `${Math.min(100, Math.max(usage.ratio > 0 ? 2 : 0, usage.ratio * 100))}%` }} />
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-slate-600">Лимит 0 — вызовы языковой модели запрещены.</p>
      )}
    </div>
  )
}
