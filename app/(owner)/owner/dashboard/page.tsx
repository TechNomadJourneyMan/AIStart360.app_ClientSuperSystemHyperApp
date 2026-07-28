'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import type { BlockStatus, Diagnostic } from '@/types/onboarding'

type CompanySummary = {
  name: string
  industry: string | null
}

type ApiResponse<T> = {
  ok: boolean
  data?: T | null
  error?: string
}

const DOMAIN_META = [
  { key: 'finance_score', label: 'Финансы', icon: 'payments' },
  { key: 'sales_score', label: 'Продажи', icon: 'trending_up' },
  { key: 'operations_score', label: 'Операции', icon: 'settings' },
  { key: 'marketing_score', label: 'Маркетинг', icon: 'campaign' },
  { key: 'strategy_score', label: 'Стратегия', icon: 'flag' },
] as const

const STATUS_META: Record<BlockStatus, { label: string; text: string; bg: string; bar: string }> = {
  critical: { label: 'Критично', text: 'text-error', bg: 'bg-error/10', bar: 'bg-error' },
  weak: { label: 'Слабо', text: 'text-orange-400', bg: 'bg-orange-400/10', bar: 'bg-orange-400' },
  average: { label: 'Средне', text: 'text-yellow-400', bg: 'bg-yellow-400/10', bar: 'bg-yellow-400' },
  strong: { label: 'Сильно', text: 'text-primary', bg: 'bg-primary/10', bar: 'bg-primary' },
  excellent: { label: 'Отлично', text: 'text-emerald-400', bg: 'bg-emerald-400/10', bar: 'bg-emerald-400' },
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

function scoreLabel(score: number | null) {
  if (score === null) return { label: 'Уровень не определён', text: 'text-on-surface-variant', bg: 'bg-white/[0.04]' }
  if (score >= 70) return { label: 'Высокий уровень', text: 'text-primary', bg: 'bg-primary/10' }
  if (score >= 45) return { label: 'Средний уровень', text: 'text-yellow-400', bg: 'bg-yellow-400/10' }
  return { label: 'Требует внимания', text: 'text-error', bg: 'bg-error/10' }
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

export default function OwnerDashboardPage() {
  const { user, isInitialized } = useAuthStore()
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [diagnosticLoaded, setDiagnosticLoaded] = useState(false)
  const [companyLoaded, setCompanyLoaded] = useState(false)
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadDashboard = useCallback(async () => {
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
      setDiagnosticError('Диагностика временно недоступна. Повторите попытку.')
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
      void loadDashboard()
    }
  }, [isInitialized, loadDashboard, user?.id])

  const blocks = useMemo(
    () =>
      DOMAIN_META.map((domain) => ({
        ...domain,
        data: diagnostic?.[domain.key] ?? null,
      })),
    [diagnostic],
  )

  const limitations = useMemo(
    () =>
      blocks
        .flatMap((block) =>
          (block.data?.top_issues ?? []).map((issue) => ({
            block: block.label,
            issue,
            score: normalizedScore(block.data?.score),
          })),
        )
        .sort((left, right) => (left.score ?? 101) - (right.score ?? 101))
        .slice(0, 5),
    [blocks],
  )

  const overallScore = normalizedScore(diagnostic?.overall_score)
  const overallMeta = scoreLabel(overallScore)
  const calculatedAt = formatCalculatedAt(diagnostic?.calculated_at)
  const evaluatedBlocks = blocks.filter((block) => normalizedScore(block.data?.score) !== null)
  const strongCount = evaluatedBlocks.filter(
    (block) => block.data?.status === 'strong' || block.data?.status === 'excellent',
  ).length
  const attentionCount = evaluatedBlocks.filter(
    (block) => block.data?.status === 'weak' || block.data?.status === 'average',
  ).length
  const criticalCount = evaluatedBlocks.filter((block) => block.data?.status === 'critical').length
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const companyName = company?.name || user?.organization
  const showInitialLoading =
    !isInitialized || (isLoading && !diagnosticLoaded && !companyLoaded && !diagnosticError && !companyError)

  if (showInitialLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-on-surface-variant">Загружаем данные дашборда...</p>
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            {firstName ? `Добро пожаловать, ${firstName}` : 'Дашборд владельца'}
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {companyName ||
              (companyLoaded
                ? 'Компания не указана'
                : companyError
                  ? 'Данные компании недоступны'
                  : 'Данные компании загружаются')}
            {' · '}
            {diagnostic
              ? calculatedAt
                ? `диагностика от ${calculatedAt}`
                : 'диагностика рассчитана'
              : diagnosticLoaded
                ? 'диагностика ещё не рассчитана'
                : 'статус диагностики недоступен'}
          </p>
        </div>
        <Link
          href="/owner/gri"
          className="flex items-center gap-2 rounded-xl border border-secondary/20 bg-secondary/10 px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary/20"
        >
          <span className="material-symbols-outlined text-lg">radar</span>
          Открыть отчёт GRI
        </Link>
      </div>

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
            onClick={() => void loadDashboard()}
            disabled={isLoading}
            className="self-start rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-400/10 disabled:opacity-50 sm:self-auto"
          >
            {isLoading ? 'Обновляем...' : 'Повторить'}
          </button>
        </div>
      )}

      {diagnostic ? (
        <>
          <section className="glass-card relative overflow-hidden rounded-2xl border border-white/[0.06] p-6">
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, #6effc0 0%, transparent 60%)' }}
            />
            <div className="relative flex flex-wrap items-center gap-6 sm:gap-8">
              <div className="flex-shrink-0">
                <div className="relative h-32 w-32">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                    {overallScore !== null && (
                      <circle
                        cx="60"
                        cy="60"
                        r="52"
                        fill="none"
                        stroke={overallScore >= 70 ? '#6effc0' : overallScore >= 45 ? '#facc15' : '#ef4444'}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${(overallScore / 100) * 327} 327`}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-3xl font-bold text-on-surface">
                      {overallScore === null ? '—' : (overallScore / 10).toFixed(1)}
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant">/ 10</span>
                  </div>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                    GRI Score
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${overallMeta.bg} ${overallMeta.text}`}>
                    {overallMeta.label}
                  </span>
                </div>
                <h2 className="mb-2 text-xl font-bold text-on-surface">Индекс готовности к росту</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                  {diagnostic.insights?.[0]?.text ||
                    'Диагностика рассчитана. Подробности по направлениям и сформированные рекомендации доступны в полном отчёте.'}
                </p>
                {evaluatedBlocks.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-on-surface-variant">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary" />
                      {strongCount} сильных
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-yellow-400" />
                      {attentionCount} требуют внимания
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-error" />
                      {criticalCount} критичных
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="glass-card rounded-2xl border border-white/[0.06] p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-xl text-secondary">bar_chart</span>
                <h2 className="text-sm font-semibold text-on-surface">Оценка по направлениям</h2>
              </div>
              <div className="space-y-3">
                {blocks.map((block) => {
                  const score = normalizedScore(block.data?.score)
                  const status = block.data?.status ? STATUS_META[block.data.status] : null

                  return (
                    <div key={block.key}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs text-on-surface-variant">{block.label}</span>
                        <span className={`font-mono text-xs font-bold ${status?.text ?? 'text-on-surface-variant'}`}>
                          {score === null ? '—' : (score / 10).toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        {score !== null && (
                          <div
                            className={`h-full rounded-full transition-all ${status?.bar ?? 'bg-on-surface-variant'}`}
                            style={{ width: `${score}%` }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="glass-card rounded-2xl border border-white/[0.06] p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-xl text-error">warning</span>
                <h2 className="text-sm font-semibold text-on-surface">Ограничения из диагностики</h2>
              </div>
              {limitations.length > 0 ? (
                <div className="space-y-2.5">
                  {limitations.map((item, index) => (
                    <div
                      key={`${item.block}-${item.issue}-${index}`}
                      className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3"
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-error/20 bg-error/10">
                        <span className="material-symbols-outlined text-sm text-error">priority_high</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-on-surface">{item.issue}</p>
                        <p className="mt-0.5 text-[10px] text-on-surface-variant">{item.block}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
                  <p className="text-sm font-medium text-on-surface">Список ограничений не сформирован</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Это не означает отсутствие рисков — в текущем расчёте нет детализации по проблемам.
                  </p>
                </div>
              )}
            </section>
          </div>
        </>
      ) : diagnosticLoaded ? (
        <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-6 md:p-8">
          <div className="max-w-2xl">
            <span className="material-symbols-outlined mb-4 text-4xl text-primary">radar</span>
            <h2 className="font-headline text-2xl font-bold text-on-surface">Диагностика ещё не рассчитана</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              На аккаунте нет текущего результата GRI. Откройте «Точку А», чтобы проверить доступный сценарий расчёта.
            </p>
            <Link
              href="/owner/point-a"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary"
            >
              Открыть «Точку А»
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </Link>
          </div>
        </section>
      ) : null}

      <section className="glass-card rounded-2xl border border-white/[0.06] p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-xl text-primary">rocket_launch</span>
          <h2 className="text-sm font-semibold text-on-surface">Доступные действия</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            {
              href: '/owner/gri',
              icon: 'radar',
              title: 'Отчёт GRI',
              desc: diagnostic ? 'Изучить блоки, риски и действия текущего расчёта' : 'Проверить статус диагностики',
              color: 'text-secondary',
              bg: 'bg-secondary/10',
            },
            {
              href: '/owner/point-a',
              icon: 'my_location',
              title: 'Точка А',
              desc: 'Открыть раздел диагностики и загрузки исходных данных',
              color: 'text-primary',
              bg: 'bg-primary/10',
            },
            {
              href: '/owner/reports',
              icon: 'description',
              title: 'Отчёты',
              desc: 'Перейти к доступным отчётам и документам',
              color: 'text-yellow-400',
              bg: 'bg-yellow-400/10',
            },
          ].map((step) => (
            <Link
              key={step.href}
              href={step.href}
              className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
            >
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${step.bg}`}>
                <span className={`material-symbols-outlined text-lg ${step.color}`}>{step.icon}</span>
              </div>
              <div>
                <p className="text-xs font-medium text-on-surface">{step.title}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-on-surface-variant">{step.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
