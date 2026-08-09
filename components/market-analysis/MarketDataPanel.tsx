'use client'

/**
 * MarketDataPanel — компактная панель «Данные рынка» в шапке блоков чек-листа.
 *
 * Тянет РЕАЛЬНЫЕ данные через authed-proxy /api/market/* (FastAPI Mark-analytics)
 * слоем `./market-api` (модульный кэш → сворачивание блока больше не бьёт по сети).
 *
 *   Блок A (TAM/SAM/SOM) → analytics/overview: KPI каталога + TAM/SAM/SOM
 *                          из подтверждённых ответов A1–A3.
 *   Блок B (Рост)        → analytics/industry-distribution: топ-отрасли.
 *   Блок E (Конкуренты)  → companies?limit=10: доли по выручке + карточка компании.
 *   Блоки C, D, F        → внешних данных нет, так и написано.
 *
 * ЧЕСТНОСТЬ: имена полей взяты из схемы Mark-analytics (AnalyticsOverview,
 * IndustryDistributionItem, CompanyListItem) — до этой правки маппинг искал
 * ключи `revenue`/`industry`, которых в контракте нет, поэтому плитки молча
 * показывали «—», а панели блоков B и E исчезали целиком.
 * Пустой ответ теперь не прячет панель, а объясняет, что данных нет.
 */

import { useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts'
import { Modal } from '@/components/ui/Modal'
import { CompetitorDetailModal } from './CompetitorDetailModal'
import {
  asArray,
  formatClock,
  formatInt,
  formatUsd,
  industryLabel,
  num,
  pick,
  placeLabel,
  str,
  unwrap,
  useMarketResource,
  type MarketResource,
} from './market-api'

// ── Types for confirmed answers passed from the parent ───────────────────────

export interface ConfirmedAnswer {
  key: string
  text: string
}

// ── Shared shell ─────────────────────────────────────────────────────────────

function PanelShell({
  accent,
  fetchedAt,
  onReload,
  reloading,
  children,
}: {
  accent: string
  fetchedAt?: number | null
  onReload?: () => void
  reloading?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-4 mb-3"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="material-symbols-outlined text-sm"
          style={{ color: accent }}
          aria-hidden="true"
        >
          monitoring
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant">
          Данные рынка
        </span>
        {fetchedAt != null && (
          <span className="text-[10px] font-mono text-on-surface-variant/50 tabular-nums">
            · обновлено {formatClock(fetchedAt)}
          </span>
        )}
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            disabled={reloading}
            aria-label="Обновить данные рынка"
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-on-surface-variant/70 hover:text-primary transition-colors disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-sm ${reloading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            >
              refresh
            </span>
            {reloading ? 'Обновляем' : 'Обновить'}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * «Не подключён» и «не ответил» — разные вещи: в первом случае кнопка «Повторить»
 * ничего не изменит, поэтому её нет.
 */
function NotConfigured() {
  return (
    <div className="flex items-start gap-2 text-xs text-on-surface-variant/80 leading-relaxed">
      <span className="material-symbols-outlined text-sm mt-0.5" aria-hidden="true">
        link_off
      </span>
      <span>
        Внешний каталог рыночных данных не подключён к кабинету. Вопросы этого блока заполняются
        вручную или AI-черновиком — на них это не влияет.
      </span>
    </div>
  )
}

function Unavailable({ onRetry, reloading }: { onRetry: () => void; reloading: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs text-on-surface-variant/80 leading-relaxed">
      <span className="material-symbols-outlined text-sm mt-0.5" aria-hidden="true">
        cloud_off
      </span>
      <span className="flex-1">
        Сервис рыночных данных не ответил.{' '}
        <button
          type="button"
          onClick={onRetry}
          disabled={reloading}
          className="underline underline-offset-2 text-primary hover:text-primary/80 disabled:opacity-50"
        >
          {reloading ? 'Обновляем…' : 'Повторить'}
        </button>
      </span>
    </div>
  )
}

function EmptyNote({ what }: { what: string }) {
  return (
    <p className="text-xs text-on-surface-variant/70 leading-relaxed">
      Каталог ответил, но {what} в нём нет.
    </p>
  )
}

function LoadingRow() {
  return (
    <div className="flex gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 flex-1 rounded-lg bg-surface-container animate-pulse" />
      ))}
    </div>
  )
}

/**
 * Общая обвязка «загрузка / не подключён / не ответил» — чтобы каждая панель
 * не повторяла одни и те же три ветки.
 */
function PanelStates<T>({
  resource,
  accent,
  emptyWhat,
  children,
}: {
  resource: MarketResource<T>
  accent: string
  emptyWhat: string
  children: (data: T) => React.ReactNode
}) {
  const { state, fetchedAt, reload, reloading } = resource

  if (state.status === 'loading')
    return (
      <PanelShell accent={accent}>
        <LoadingRow />
      </PanelShell>
    )
  if (state.status === 'not_configured')
    return (
      <PanelShell accent={accent}>
        <NotConfigured />
      </PanelShell>
    )
  if (state.status === 'unavailable')
    return (
      <PanelShell accent={accent} onReload={reload} reloading={!!reloading}>
        <Unavailable onRetry={reload} reloading={!!reloading} />
      </PanelShell>
    )
  if (state.status === 'empty')
    return (
      <PanelShell accent={accent} fetchedAt={fetchedAt} onReload={reload} reloading={!!reloading}>
        <EmptyNote what={emptyWhat} />
      </PanelShell>
    )

  return (
    <PanelShell accent={accent} fetchedAt={fetchedAt} onReload={reload} reloading={!!reloading}>
      {children(state.data)}
    </PanelShell>
  )
}

// ── Block A: catalog KPIs + TAM/SAM/SOM from confirmed answers ───────────────

interface OverviewData {
  totalRevenueUsd: number | null
  companies: number | null
  industries: number | null
  active: number | null
  newThisMonth: number | null
}

/** AnalyticsOverview: total_companies / revenue_total_usd / industries_count. */
function mapOverview(payload: unknown): OverviewData | null {
  const d = unwrap(payload)
  if (!d || typeof d !== 'object') return null
  const out: OverviewData = {
    totalRevenueUsd: num(pick(d, ['revenue_total_usd'])),
    companies: num(pick(d, ['total_companies'])),
    industries: num(pick(d, ['industries_count'])),
    active: num(pick(d, ['active'])),
    newThisMonth: num(pick(d, ['new_this_month'])),
  }
  const anything =
    out.totalRevenueUsd != null || out.companies != null || out.industries != null
  return anything ? out : null
}

interface StatSource {
  label: string
  value: string
  field: string
  endpoint: string
  meaning: string
}

function BlockAPanel({ accent, confirmed }: { accent: string; confirmed: ConfirmedAnswer[] }) {
  const resource = useMarketResource<OverviewData>('analytics/overview', mapOverview)
  const [explain, setExplain] = useState<StatSource | null>(null)

  const byKey = new Map(confirmed.map((c) => [c.key, c.text]))
  const tamSamSom = [
    { label: 'TAM', key: 'A1' },
    { label: 'SAM', key: 'A2' },
    { label: 'SOM', key: 'A3' },
  ]
    .map((t) => ({ ...t, value: byKey.get(t.key) ?? null }))
    .filter((t): t is { label: string; key: string; value: string } => t.value != null)

  return (
    <>
      <PanelStates resource={resource} accent={accent} emptyWhat="сводных показателей">
        {(d) => (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                icon="payments"
                label="Выручка каталога"
                value={d.totalRevenueUsd != null ? formatUsd(d.totalRevenueUsd) : null}
                accent={accent}
                onExplain={
                  d.totalRevenueUsd != null
                    ? () =>
                        setExplain({
                          label: 'Выручка каталога',
                          value: formatUsd(d.totalRevenueUsd as number),
                          field: 'revenue_total_usd',
                          endpoint: 'analytics/overview',
                          meaning:
                            'Сумма выручки всех компаний каталога Mark-analytics под текущими фильтрами. Валюта — доллар США, так задано в источнике.',
                        })
                    : undefined
                }
              />
              <StatTile
                icon="apartment"
                label="Компаний"
                value={d.companies != null ? formatInt(d.companies) : null}
                accent={accent}
                onExplain={
                  d.companies != null
                    ? () =>
                        setExplain({
                          label: 'Компаний',
                          value: formatInt(d.companies as number),
                          field: 'total_companies',
                          endpoint: 'analytics/overview',
                          meaning:
                            'Сколько компаний вообще есть в каталоге. Это размер справочника, а не размер вашего рынка.',
                        })
                    : undefined
                }
              />
              <StatTile
                icon="category"
                label="Отраслей"
                value={d.industries != null ? formatInt(d.industries) : null}
                accent={accent}
                onExplain={
                  d.industries != null
                    ? () =>
                        setExplain({
                          label: 'Отраслей',
                          value: formatInt(d.industries as number),
                          field: 'industries_count',
                          endpoint: 'analytics/overview',
                          meaning:
                            'Число различных отраслей среди компаний каталога.',
                        })
                    : undefined
                }
              />
            </div>
            {(d.active != null || d.newThisMonth != null) && (
              <p className="text-[11px] text-on-surface-variant/70 mt-2 tabular-nums">
                {d.active != null && <>Действующих: {formatInt(d.active)}</>}
                {d.active != null && d.newThisMonth != null && ' · '}
                {d.newThisMonth != null && <>новых за месяц: {formatInt(d.newThisMonth)}</>}
              </p>
            )}
            <TamSamSom tiles={tamSamSom} accent={accent} />
          </>
        )}
      </PanelStates>

      {/* Панель недоступна, но подтверждённые A1–A3 всё равно надо показать */}
      {resource.state.status !== 'ready' && tamSamSom.length > 0 && (
        <PanelShell accent={accent}>
          <TamSamSom tiles={tamSamSom} accent={accent} />
        </PanelShell>
      )}

      {explain && <StatExplainModal source={explain} onClose={() => setExplain(null)} />}
    </>
  )
}

function TamSamSom({
  tiles,
  accent,
}: {
  tiles: Array<{ label: string; key: string; value: string }>
  accent: string
}) {
  if (tiles.length === 0) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
      {tiles.map((t) => (
        <div
          key={t.key}
          className="rounded-lg border px-3 py-2"
          style={{ borderColor: 'rgba(110,255,192,0.25)', background: 'rgba(110,255,192,0.06)' }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: accent }}>
            {t.label} · ваш ответ {t.key}
          </p>
          <p className="text-xs text-on-surface mt-1 leading-snug line-clamp-3">{t.value}</p>
        </div>
      ))}
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  accent,
  onExplain,
}: {
  icon: string
  label: string
  value: string | null
  accent: string
  onExplain?: () => void
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="material-symbols-outlined text-[13px]"
          style={{ color: accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant truncate">
          {label}
        </span>
      </div>
      <p className="text-base font-mono font-black text-on-surface tabular-nums leading-none text-left">
        {value ?? <span className="text-on-surface-variant/50">нет данных</span>}
      </p>
    </>
  )

  if (!onExplain) {
    return (
      <div className="rounded-lg bg-surface-container px-3 py-2.5 border border-white/[0.04]">
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onExplain}
      aria-label={`${label}: ${value}. Откуда это число`}
      className="rounded-lg bg-surface-container px-3 py-2.5 border border-white/[0.04] text-left hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
    >
      {body}
    </button>
  )
}

/** Разбор рыночного агрегата: происхождение, а не выдуманный график. */
function StatExplainModal({ source, onClose }: { source: StatSource; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={source.label} size="md">
      <div className="space-y-4">
        <p className="text-2xl font-mono font-black text-primary tabular-nums">{source.value}</p>
        <p className="text-sm text-on-surface-variant leading-relaxed">{source.meaning}</p>
        <div className="rounded-lg bg-surface-container px-3 py-2.5 border border-white/[0.04] space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
            Откуда
          </p>
          <p className="text-xs font-mono text-on-surface break-all">
            GET /api/market/{source.endpoint} → поле <b>{source.field}</b>
          </p>
          <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
            Каталог Mark-analytics. Кабинет ничего не досчитывает: показано ровно то число, которое
            вернул источник.
          </p>
        </div>
      </div>
    </Modal>
  )
}

// ── Block B: top industries by revenue ───────────────────────────────────────

interface IndustryRow {
  name: string
  revenueUsd: number
  companies: number | null
}

/** IndustryDistributionItem: industry_label / industry_code / revenue_usd. */
function mapIndustries(payload: unknown): IndustryRow[] | null {
  const rows = asArray(unwrap(payload))
    .map((item) => {
      const name = str(pick(item, ['industry_label'])) ?? str(pick(item, ['industry_code']))
      const revenueUsd = num(pick(item, ['revenue_usd']))
      return name && revenueUsd != null && revenueUsd > 0
        ? { name, revenueUsd, companies: num(pick(item, ['companies'])) }
        : null
    })
    .filter((x): x is IndustryRow => x != null)
    .sort((a, b) => b.revenueUsd - a.revenueUsd)
    .slice(0, 6)
  return rows.length ? rows : null
}

function BlockBPanel({ accent }: { accent: string }) {
  const resource = useMarketResource<IndustryRow[]>(
    'analytics/industry-distribution',
    mapIndustries,
  )

  return (
    <PanelStates resource={resource} accent={accent} emptyWhat="отраслевого разреза по выручке">
      {(rows) => (
        <>
          <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">
            Топ-отрасли по выручке, $
          </p>
          {/* Chart is decoration over the list below: recharts-тултип доступен
              только мышью, поэтому все значения продублированы текстом. */}
          <div
            style={{ width: '100%', height: Math.max(120, rows.length * 30) }}
            aria-hidden="true"
          >
            <ResponsiveContainer>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Bar dataKey="revenueUsd" radius={[0, 6, 6, 0]} fill={accent} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1">
            {rows.map((r) => (
              <li key={r.name} className="flex items-baseline gap-2 text-xs">
                <span className="text-on-surface truncate flex-1">{r.name}</span>
                {r.companies != null && (
                  <span className="font-mono tabular-nums text-on-surface-variant/60 shrink-0">
                    {formatInt(r.companies)} комп.
                  </span>
                )}
                <span className="font-mono tabular-nums text-on-surface-variant shrink-0">
                  {formatUsd(r.revenueUsd)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelStates>
  )
}

// ── Block E: competitors — donut + clickable list → detail card ──────────────

interface CompanyRow {
  id: string | null
  name: string
  revenueUsd: number | null
  industry: string | null
  place: string | null
  employees: number | null
}

const DONUT_COLORS = ['#fca5a5', '#f0abfc', '#c4b5fd', '#7dd3fc', '#6effc0', '#fcd34d']

/** CompanyListItem: id / name / revenue_usd (строка) / industry{label} / region_name. */
function mapCompanies(payload: unknown): CompanyRow[] | null {
  const rows = asArray(unwrap(payload))
    .map((item) => {
      const name = str(pick(item, ['name']))
      if (!name) return null
      return {
        id: str(pick(item, ['id'])) ?? str(pick(item, ['bin'])),
        name,
        revenueUsd: num(pick(item, ['revenue_usd'])),
        industry: industryLabel(item),
        place: placeLabel(item),
        employees: num(pick(item, ['employee_count'])),
      }
    })
    .filter((x): x is CompanyRow => x != null)
    // Выручка вперёд, компании без неё — в хвост, но не выбрасываем: имя и
    // отрасль конкурента полезны сами по себе.
    .sort((a, b) => (b.revenueUsd ?? -1) - (a.revenueUsd ?? -1))
    .slice(0, 5)
  return rows.length ? rows : null
}

function BlockEPanel({ accent }: { accent: string }) {
  const resource = useMarketResource<CompanyRow[]>('companies?limit=10', mapCompanies)
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)

  return (
    <>
      <PanelStates resource={resource} accent={accent} emptyWhat="компаний по вашему профилю">
        {(rows) => {
          const withRevenue = rows.filter(
            (r): r is CompanyRow & { revenueUsd: number } => r.revenueUsd != null && r.revenueUsd > 0,
          )
          const total = withRevenue.reduce((s, r) => s + r.revenueUsd, 0)
          const showDonut = withRevenue.length >= 2 && total > 0

          return (
            <>
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">
                {showDonut ? 'Доли по выручке · топ-5' : 'Компании каталога · топ-5'}
              </p>
              <div className="flex items-start gap-4 flex-wrap">
                {showDonut && (
                  <div style={{ width: 140, height: 140 }} className="shrink-0" aria-hidden="true">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={withRevenue}
                          dataKey="revenueUsd"
                          nameKey="name"
                          innerRadius={42}
                          outerRadius={66}
                          paddingAngle={2}
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {withRevenue.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <ul className="flex-1 min-w-[200px] space-y-1">
                  {rows.map((r, i) => {
                    const share =
                      showDonut && r.revenueUsd != null && r.revenueUsd > 0
                        ? Math.round((r.revenueUsd / total) * 100)
                        : null
                    const meta = [r.industry, r.place].filter(Boolean).join(' · ')
                    const inner = (
                      <>
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-on-surface truncate">{r.name}</span>
                          {meta && (
                            <span className="block text-[10px] text-on-surface-variant/60 truncate">
                              {meta}
                            </span>
                          )}
                        </span>
                        {r.revenueUsd != null ? (
                          <span className="font-mono tabular-nums text-on-surface-variant shrink-0">
                            {formatUsd(r.revenueUsd)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-on-surface-variant/50 shrink-0">
                            выручка не указана
                          </span>
                        )}
                        {share != null && (
                          <span className="font-mono tabular-nums text-on-surface-variant/60 w-9 text-right shrink-0">
                            {share}%
                          </span>
                        )}
                      </>
                    )

                    return (
                      <li key={r.id ?? r.name}>
                        {r.id ? (
                          <button
                            type="button"
                            onClick={() => setSelected({ id: r.id as string, name: r.name })}
                            aria-label={`Открыть карточку конкурента ${r.name}`}
                            className="w-full flex items-center gap-2 text-xs text-left rounded-lg px-2 py-1.5 hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                          >
                            {inner}
                            <span
                              className="material-symbols-outlined text-sm text-on-surface-variant/60 shrink-0"
                              aria-hidden="true"
                            >
                              chevron_right
                            </span>
                          </button>
                        ) : (
                          <div className="w-full flex items-center gap-2 text-xs px-2 py-1.5">
                            {inner}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <p className="text-[10px] text-on-surface-variant/50 mt-2">
                Нажмите на компанию — откроется карточка из каталога.
              </p>
            </>
          )
        }}
      </PanelStates>

      {selected && (
        <CompetitorDetailModal
          key={selected.id}
          companyId={selected.id}
          fallbackName={selected.name}
          onClose={() => setSelected(null)}
          onOpenCompany={(id, name) => setSelected({ id, name })}
        />
      )}
    </>
  )
}

// ── Blocks without an external source ────────────────────────────────────────

function ManualOnlyNote({ accent }: { accent: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-2.5 mb-3 flex items-start gap-2"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}
    >
      <span
        className="material-symbols-outlined text-sm mt-0.5"
        style={{ color: accent }}
        aria-hidden="true"
      >
        edit_note
      </span>
      <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
        Внешних данных для этого блока нет — он заполняется вашими ответами и AI-черновиком.
      </p>
    </div>
  )
}

// ── Public dispatcher ────────────────────────────────────────────────────────

export function MarketDataPanel({
  blockId,
  accent,
  confirmed,
}: {
  blockId: string
  accent: string
  confirmed: ConfirmedAnswer[]
}) {
  if (blockId === 'A') return <BlockAPanel accent={accent} confirmed={confirmed} />
  if (blockId === 'B') return <BlockBPanel accent={accent} />
  if (blockId === 'E') return <BlockEPanel accent={accent} />
  return <ManualOnlyNote accent={accent} />
}
