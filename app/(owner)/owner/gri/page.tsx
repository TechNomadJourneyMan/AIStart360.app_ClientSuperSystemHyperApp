'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import type {
  BlockScore,
  BlockStatus,
  Diagnostic,
  QuickWin,
  Risk,
  RiskLevel,
} from '@/types/onboarding'

type CompanySummary = {
  name: string
  industry: string | null
}

type ApiResponse<T> = {
  ok: boolean
  data?: T | null
  error?: string
}

type Domain = {
  key: string
  label: string
  icon: string
  data: BlockScore | null
}

const DOMAIN_META = [
  { key: 'finance_score', label: 'Финансы', icon: 'payments' },
  { key: 'sales_score', label: 'Продажи', icon: 'trending_up' },
  { key: 'operations_score', label: 'Операции', icon: 'settings' },
  { key: 'marketing_score', label: 'Маркетинг', icon: 'campaign' },
  { key: 'strategy_score', label: 'Стратегия', icon: 'flag' },
] as const

const STATUS_META: Record<BlockStatus, { label: string; text: string; bg: string; border: string; bar: string }> = {
  critical: {
    label: 'Критично',
    text: 'text-error',
    bg: 'bg-error/10',
    border: 'border-error/20',
    bar: 'bg-error',
  },
  weak: {
    label: 'Слабо',
    text: 'text-orange-400',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/20',
    bar: 'bg-orange-400',
  },
  average: {
    label: 'Средне',
    text: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/20',
    bar: 'bg-yellow-400',
  },
  strong: {
    label: 'Сильно',
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/20',
    bar: 'bg-primary',
  },
  excellent: {
    label: 'Отлично',
    text: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
    bar: 'bg-emerald-400',
  },
}

const RISK_META: Record<RiskLevel, { label: string; text: string; bg: string; border: string }> = {
  critical: { label: 'Критичный', text: 'text-error', bg: 'bg-error/10', border: 'border-error/20' },
  important: {
    label: 'Важный',
    text: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/20',
  },
  moderate: {
    label: 'Умеренный',
    text: 'text-on-surface-variant',
    bg: 'bg-white/[0.04]',
    border: 'border-white/[0.08]',
  },
}

async function fetchData<T>(url: string, fallbackMessage: string): Promise<T | null> {
  const response = await fetch(url, { cache: 'no-store' })
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || fallbackMessage)
  }

  return payload.data ?? null
}

function normalizedScore(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

function formatCalculatedAt(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function overallMeta(score: number | null) {
  if (score === null) {
    return { label: 'Уровень не определён', text: 'text-on-surface-variant', bg: 'bg-white/[0.04]', stroke: '#8b949e' }
  }
  if (score >= 70) {
    return { label: 'Высокий уровень', text: 'text-primary', bg: 'bg-primary/10', stroke: '#6effc0' }
  }
  if (score >= 45) {
    return { label: 'Средний уровень', text: 'text-yellow-400', bg: 'bg-yellow-400/10', stroke: '#facc15' }
  }
  return { label: 'Требует внимания', text: 'text-error', bg: 'bg-error/10', stroke: '#ef4444' }
}

function diagnosticAreaLabel(value: string) {
  if (!value) return 'Область не указана'
  const match = DOMAIN_META.find(
    (domain) => domain.key.replace('_score', '') === value.toLowerCase(),
  )
  return match?.label ?? value
}

function OverviewTab({
  blocks,
  activeBlock,
  onToggle,
}: {
  blocks: Domain[]
  activeBlock: string | null
  onToggle: (key: string) => void
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        const score = normalizedScore(block.data?.score)
        const status = block.data?.status ? STATUS_META[block.data.status] : null
        const expanded = activeBlock === block.key
        const hasDetails =
          (block.data?.top_issues?.length ?? 0) > 0 ||
          (block.data?.recommendations?.length ?? 0) > 0

        return (
          <section
            key={block.key}
            className={`glass-card rounded-2xl border transition-all ${
              expanded ? 'border-white/[0.1] bg-white/[0.04]' : 'border-white/[0.04]'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(block.key)}
              disabled={!hasDetails}
              aria-expanded={hasDetails ? expanded : undefined}
              className="w-full rounded-2xl p-4 text-left transition-colors enabled:hover:bg-white/[0.02] disabled:cursor-default"
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div
                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border ${
                    status ? `${status.bg} ${status.border}` : 'border-white/[0.06] bg-white/[0.03]'
                  }`}
                >
                  <span className={`font-mono text-lg font-bold ${status?.text ?? 'text-on-surface-variant'}`}>
                    {score === null ? '—' : (score / 10).toFixed(1)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="material-symbols-outlined text-lg text-primary">{block.icon}</span>
                      <h3 className="truncate text-sm font-semibold text-on-surface">{block.label}</h3>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                        status
                          ? `${status.bg} ${status.text} ${status.border}`
                          : 'border-white/[0.06] text-on-surface-variant'
                      }`}
                    >
                      {status?.label ?? 'Нет оценки'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                    {score !== null && (
                      <div className={`h-full rounded-full ${status?.bar ?? 'bg-on-surface-variant'}`} style={{ width: `${score}%` }} />
                    )}
                  </div>
                </div>
                {hasDetails && (
                  <span
                    className={`material-symbols-outlined text-lg text-on-surface-variant transition-transform ${
                      expanded ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                )}
              </div>
            </button>

            {expanded && block.data && (
              <div className="space-y-4 border-t border-white/[0.04] px-4 pb-4 pt-4">
                {block.data.top_issues.length > 0 && (
                  <div>
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Зафиксированные проблемы
                    </p>
                    <ul className="space-y-1.5">
                      {block.data.top_issues.map((issue, index) => (
                        <li key={`${issue}-${index}`} className="flex items-start gap-2 text-xs text-on-surface-variant">
                          <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-xs text-error">warning</span>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {block.data.recommendations.length > 0 && (
                  <div>
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Рекомендации расчёта
                    </p>
                    <ul className="space-y-1.5">
                      {block.data.recommendations.map((recommendation, index) => (
                        <li
                          key={`${recommendation}-${index}`}
                          className="flex items-start gap-2 text-xs text-on-surface-variant"
                        >
                          <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-xs text-primary">
                            arrow_forward
                          </span>
                          {recommendation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function LimitsTab({ risks, blocks }: { risks: Risk[]; blocks: Domain[] }) {
  const issues = blocks.flatMap((block) =>
    (block.data?.top_issues ?? []).map((text) => ({
      area: block.label,
      text,
      score: normalizedScore(block.data?.score),
    })),
  )

  if (risks.length === 0 && issues.length === 0) {
    return (
      <div className="glass-card rounded-2xl border border-dashed border-white/10 p-8 text-center">
        <span className="material-symbols-outlined mb-3 text-3xl text-on-surface-variant/40">fact_check</span>
        <p className="text-sm font-medium text-on-surface">Риски и ограничения не сформированы</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Это означает отсутствие детализации в текущем расчёте, а не подтверждённое отсутствие рисков.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card space-y-3 rounded-2xl border border-white/[0.06] p-4 sm:p-5">
      {risks.map((risk, index) => {
        const meta = RISK_META[risk.level] ?? RISK_META.moderate
        return (
          <article
            key={`${risk.area}-${risk.text}-${index}`}
            className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 sm:gap-4"
          >
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border ${meta.bg} ${meta.border}`}>
              <span className={`material-symbols-outlined text-base ${meta.text}`}>warning</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-on-surface">{risk.text}</p>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${meta.bg} ${meta.border} ${meta.text}`}>
                  {meta.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                {diagnosticAreaLabel(risk.area)}
                {risk.impact ? ` · Влияние: ${risk.impact}` : ''}
              </p>
            </div>
          </article>
        )
      })}

      {risks.length === 0 &&
        issues
          .sort((left, right) => (left.score ?? 101) - (right.score ?? 101))
          .map((issue, index) => (
            <article
              key={`${issue.area}-${issue.text}-${index}`}
              className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 sm:gap-4"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-error/20 bg-error/10">
                <span className="material-symbols-outlined text-base text-error">priority_high</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface">{issue.text}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{issue.area}</p>
              </div>
            </article>
          ))}
    </div>
  )
}

function PlanTab({ quickWins, blocks }: { quickWins: QuickWin[]; blocks: Domain[] }) {
  const recommendations = blocks.flatMap((block) =>
    (block.data?.recommendations ?? []).map((action) => ({
      action,
      timeline: null,
      area: block.label,
    })),
  )
  const actions =
    quickWins.length > 0
      ? quickWins.map((item) => ({
          action: item.action,
          timeline: item.timeline || null,
          area: diagnosticAreaLabel(item.area),
        }))
      : recommendations

  if (actions.length === 0) {
    return (
      <div className="glass-card rounded-2xl border border-dashed border-white/10 p-8 text-center">
        <span className="material-symbols-outlined mb-3 text-3xl text-on-surface-variant/40">event_note</span>
        <p className="text-sm font-medium text-on-surface">План действий не сформирован</p>
        <p className="mt-1 text-xs text-on-surface-variant">
          В текущем расчёте нет быстрых действий или рекомендаций.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl border border-white/[0.06] p-4 sm:p-5">
      <p className="mb-5 text-xs text-on-surface-variant">
        Действия ниже сформированы текущей диагностикой. Срок показан только там, где он есть в расчёте.
      </p>
      <div className="space-y-3">
        {actions.map((item, index) => (
          <article
            key={`${item.area}-${item.action}-${index}`}
            className="flex flex-col gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 sm:flex-row sm:items-start"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <span className="material-symbols-outlined text-base text-primary">arrow_forward</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-on-surface">{item.action}</p>
              <p className="mt-1 text-[10px] text-on-surface-variant">{item.area}</p>
            </div>
            {item.timeline && (
              <span className="self-start rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {item.timeline}
              </span>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

export default function OwnerGriPage() {
  const { user, isInitialized } = useAuthStore()
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [diagnosticLoaded, setDiagnosticLoaded] = useState(false)
  const [companyLoaded, setCompanyLoaded] = useState(false)
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeBlock, setActiveBlock] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'limits' | 'plan'>('overview')

  const loadDiagnostic = useCallback(async () => {
    if (!user?.id) return

    setIsLoading(true)
    setDiagnosticError(null)
    setCompanyError(null)

    const [diagnosticResult, companyResult] = await Promise.allSettled([
      fetchData<Diagnostic>(
        `/api/v1/diagnostics/current?user_id=${encodeURIComponent(user.id)}`,
        'Не удалось загрузить диагностику.',
      ),
      fetchData<CompanySummary>(
        `/api/v1/onboarding/company?user_id=${encodeURIComponent(user.id)}`,
        'Не удалось загрузить данные компании.',
      ),
    ])

    if (diagnosticResult.status === 'fulfilled') {
      setDiagnostic(diagnosticResult.value)
      setDiagnosticLoaded(true)
    } else {
      setDiagnosticError('Диагностика временно недоступна. Проверьте соединение и повторите попытку.')
    }

    if (companyResult.status === 'fulfilled') {
      setCompany(companyResult.value)
      setCompanyLoaded(true)
    } else {
      setCompanyError('Данные компании временно недоступны.')
    }

    setIsLoading(false)
  }, [user?.id])

  useEffect(() => {
    if (isInitialized && user?.id) {
      void loadDiagnostic()
    }
  }, [isInitialized, loadDiagnostic, user?.id])

  const blocks = useMemo<Domain[]>(
    () =>
      DOMAIN_META.map((domain) => ({
        ...domain,
        data: diagnostic?.[domain.key] ?? null,
      })),
    [diagnostic],
  )

  const score = normalizedScore(diagnostic?.overall_score)
  const scoreMeta = overallMeta(score)
  const calculatedAt = formatCalculatedAt(diagnostic?.calculated_at)
  const companyName = company?.name || user?.organization
  const evaluatedBlocks = blocks.filter((block) => normalizedScore(block.data?.score) !== null)
  const criticalCount = evaluatedBlocks.filter((block) => block.data?.status === 'critical').length
  const attentionCount = evaluatedBlocks.filter(
    (block) => block.data?.status === 'weak' || block.data?.status === 'average',
  ).length
  const strongCount = evaluatedBlocks.filter(
    (block) => block.data?.status === 'strong' || block.data?.status === 'excellent',
  ).length
  const risks = diagnostic?.risks ?? []
  const quickWins = diagnostic?.quick_wins ?? []
  const hasLimitDetails =
    risks.length > 0 || blocks.some((block) => (block.data?.top_issues?.length ?? 0) > 0)
  const hasPlanDetails =
    quickWins.length > 0 || blocks.some((block) => (block.data?.recommendations?.length ?? 0) > 0)
  const showInitialLoading =
    !isInitialized || (isLoading && !diagnosticLoaded && !companyLoaded && !diagnosticError && !companyError)

  if (showInitialLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-on-surface-variant">Загружаем отчёт GRI...</p>
      </div>
    )
  }

  if (isInitialized && !user) {
    return (
      <div className="rounded-2xl border border-error/25 bg-error/10 p-6" role="alert">
        <h1 className="font-headline text-xl font-bold text-on-surface">Не удалось определить аккаунт</h1>
        <p className="mt-2 text-sm text-on-surface-variant">Обновите страницу и повторите попытку.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">GRI: результаты диагностики</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {companyName ||
              (companyLoaded
                ? 'Компания не указана'
                : companyError
                  ? 'Данные компании недоступны'
                  : 'Данные компании загружаются')}
            {calculatedAt ? ` · расчёт от ${calculatedAt}` : ''}
          </p>
        </div>
        <Link
          href="/owner/point-a"
          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:border-primary/25 hover:text-primary"
        >
          <span className="material-symbols-outlined text-lg">my_location</span>
          Открыть «Точку А»
        </Link>
      </header>

      {(diagnosticError || companyError) && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-medium text-on-surface">Не все данные удалось обновить</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {[diagnosticError, companyError].filter(Boolean).join(' ')}
              {(diagnostic || company) && ' Ниже показаны последние успешно загруженные данные.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDiagnostic()}
            disabled={isLoading}
            className="self-start rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-400/10 disabled:opacity-50 sm:self-auto"
          >
            {isLoading ? 'Обновляем...' : 'Повторить'}
          </button>
        </div>
      )}

      {diagnostic ? (
        <>
          <section className="glass-card relative overflow-hidden rounded-2xl border border-white/[0.06] p-5 sm:p-6">
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #6effc0 0%, transparent 60%)' }}
            />
            <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
              <div className="relative h-36 w-36 flex-shrink-0">
                <svg viewBox="0 0 200 200" className="h-full w-full opacity-80" aria-hidden="true">
                  {[20, 40, 60, 80].map((radius) => (
                    <polygon
                      key={radius}
                      points={Array.from({ length: blocks.length }, (_, index) => {
                        const angle = (index * 2 * Math.PI) / blocks.length - Math.PI / 2
                        return `${100 + radius * Math.cos(angle)},${100 + radius * Math.sin(angle)}`
                      }).join(' ')}
                      fill="none"
                      stroke="rgba(255,255,255,0.07)"
                      strokeWidth="1"
                    />
                  ))}
                  {blocks.map((block, index) => {
                    const angle = (index * 2 * Math.PI) / blocks.length - Math.PI / 2
                    return (
                      <line
                        key={block.key}
                        x1="100"
                        y1="100"
                        x2={100 + 80 * Math.cos(angle)}
                        y2={100 + 80 * Math.sin(angle)}
                        stroke="rgba(255,255,255,0.07)"
                        strokeWidth="1"
                      />
                    )
                  })}
                  {evaluatedBlocks.length === blocks.length && (
                    <>
                      <polygon
                        points={blocks
                          .map((block, index) => {
                            const angle = (index * 2 * Math.PI) / blocks.length - Math.PI / 2
                            const radius = ((normalizedScore(block.data?.score) ?? 0) / 100) * 80
                            return `${100 + radius * Math.cos(angle)},${100 + radius * Math.sin(angle)}`
                          })
                          .join(' ')}
                        fill="rgba(110,255,192,0.12)"
                        stroke="#6effc0"
                        strokeWidth="1.5"
                      />
                      {blocks.map((block, index) => {
                        const angle = (index * 2 * Math.PI) / blocks.length - Math.PI / 2
                        const radius = ((normalizedScore(block.data?.score) ?? 0) / 100) * 80
                        const status = block.data?.status ? STATUS_META[block.data.status] : null
                        const fill =
                          status?.label === 'Критично'
                            ? '#ef4444'
                            : status?.label === 'Слабо' || status?.label === 'Средне'
                              ? '#facc15'
                              : '#6effc0'
                        return (
                          <circle
                            key={block.key}
                            cx={100 + radius * Math.cos(angle)}
                            cy={100 + radius * Math.sin(angle)}
                            r="4"
                            fill={fill}
                          />
                        )
                      })}
                    </>
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <p className="font-mono text-2xl font-bold text-on-surface">
                      {score === null ? '—' : (score / 10).toFixed(1)}
                    </p>
                    <p className="font-mono text-[9px] text-on-surface-variant">GRI / 10</p>
                  </div>
                </div>
              </div>

              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Итоговый GRI Score
                </p>
                <div className="mb-2 flex flex-wrap items-baseline justify-center gap-3 sm:justify-start">
                  <span className={`font-mono text-4xl font-bold ${scoreMeta.text}`}>
                    {score === null ? '—' : (score / 10).toFixed(1)}
                  </span>
                  <span className="text-lg text-on-surface-variant">/ 10</span>
                  <span className={`rounded-full px-3 py-1 font-mono text-xs ${scoreMeta.bg} ${scoreMeta.text}`}>
                    {scoreMeta.label}
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                  {diagnostic.insights?.[0]?.text ||
                    'Расчёт выполнен. Раскройте направления ниже, чтобы увидеть зафиксированные проблемы и рекомендации.'}
                </p>
                {evaluatedBlocks.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-3 sm:justify-start">
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                      <p className="font-mono text-sm font-bold text-primary">{strongCount}</p>
                      <p className="text-[10px] text-on-surface-variant">сильных</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                      <p className="font-mono text-sm font-bold text-yellow-400">{attentionCount}</p>
                      <p className="text-[10px] text-on-surface-variant">требуют внимания</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                      <p className="font-mono text-sm font-bold text-error">{criticalCount}</p>
                      <p className="text-[10px] text-on-surface-variant">критичных</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="max-w-full overflow-x-auto">
            <div className="flex w-max min-w-full gap-1 rounded-xl border border-white/[0.04] bg-surface-container p-1 sm:w-fit sm:min-w-0">
              {[
                { id: 'overview', label: 'По направлениям' },
                { id: 'limits', label: hasLimitDetails ? 'Риски и ограничения' : 'Риски' },
                { id: 'plan', label: hasPlanDetails ? 'План действий' : 'Действия' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? 'border border-secondary/20 bg-secondary/10 text-secondary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'overview' && (
            <OverviewTab
              blocks={blocks}
              activeBlock={activeBlock}
              onToggle={(key) => setActiveBlock((current) => (current === key ? null : key))}
            />
          )}
          {activeTab === 'limits' && <LimitsTab risks={risks} blocks={blocks} />}
          {activeTab === 'plan' && <PlanTab quickWins={quickWins} blocks={blocks} />}
        </>
      ) : diagnosticLoaded ? (
        <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-6 text-center md:p-10">
          <span className="material-symbols-outlined mb-4 text-5xl text-primary">radar</span>
          <h2 className="font-headline text-2xl font-bold text-on-surface">Текущей диагностики нет</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-on-surface-variant">
            API ответил успешно, но для этого аккаунта ещё нет актуального расчёта GRI.
          </p>
          <Link
            href="/owner/point-a"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary"
          >
            Открыть «Точку А»
            <span className="material-symbols-outlined text-lg">arrow_forward</span>
          </Link>
        </section>
      ) : null}
    </div>
  )
}
