'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import type { Diagnostic, DiagnosticStage } from '@/types/onboarding'

const STAGE_LABELS: Record<DiagnosticStage, string> = {
  seed: 'Seed',
  early: 'Early',
  growth: 'Growth',
  scale: 'Scale',
  mature: 'Mature',
}

const DOMAIN_LABELS = [
  { key: 'finance_score', label: 'Финансы', icon: 'payments' },
  { key: 'sales_score', label: 'Продажи', icon: 'trending_up' },
  { key: 'operations_score', label: 'Операции', icon: 'settings' },
  { key: 'marketing_score', label: 'Маркетинг', icon: 'campaign' },
  { key: 'strategy_score', label: 'Стратегия', icon: 'flag' },
] as const

type CompanySummary = {
  name: string
  industry: string | null
}

type ResourceStatus = 'idle' | 'success' | 'error'

async function fetchApiData<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const payload: unknown = await response.json().catch(() => null)

  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new Error('Сервер вернул некорректный ответ.')
  }

  const envelope = payload as { ok: unknown; data?: unknown; error?: unknown }
  if (!response.ok) {
    throw new Error(typeof envelope.error === 'string' ? envelope.error : 'Ошибка запроса.')
  }
  if (envelope.ok !== true || !('data' in envelope)) {
    throw new Error(typeof envelope.error === 'string' ? envelope.error : 'Сервер не подтвердил результат.')
  }

  return envelope.data as T
}

export default function ClientDashboardPage() {
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [diagnosticStatus, setDiagnosticStatus] = useState<ResourceStatus>('idle')
  const [companyStatus, setCompanyStatus] = useState<ResourceStatus>('idle')
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)

    try {
      const supabase = createClient()
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user?.id) {
        throw new Error('Не удалось подготовить данные дашборда.')
      }

      const [diagnosticResult, companyResult] = await Promise.allSettled([
        fetchApiData<Diagnostic | null>(`/api/v1/diagnostics/current?user_id=${encodeURIComponent(user.id)}`),
        fetchApiData<CompanySummary | null>(`/api/v1/onboarding/company?user_id=${encodeURIComponent(user.id)}`),
      ])

      if (diagnosticResult.status === 'fulfilled') {
        setDiagnostic(diagnosticResult.value)
        setDiagnosticStatus('success')
        setDiagnosticError(null)
      } else {
        setDiagnosticStatus('error')
        setDiagnosticError('Не удалось обновить диагностику.')
      }

      if (companyResult.status === 'fulfilled') {
        setCompany(companyResult.value)
        setCompanyStatus('success')
        setCompanyError(null)
      } else {
        setCompanyStatus('error')
        setCompanyError('Не удалось обновить данные компании.')
      }
    } catch {
      setDiagnosticStatus('error')
      setCompanyStatus('error')
      setDiagnosticError('Не удалось загрузить диагностику.')
      setCompanyError('Не удалось загрузить данные компании.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const isInitialLoading =
    isLoading && diagnosticStatus === 'idle' && companyStatus === 'idle'

  if (isInitialLoading) {
    return (
      <div role="status" className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-on-surface-variant">Собираем ваш дашборд...</p>
      </div>
    )
  }

  const overallScore = diagnostic?.overall_score
  const hasOverallScore = typeof overallScore === 'number' && Number.isFinite(overallScore)
  const hasLoadError = diagnosticStatus === 'error' || companyStatus === 'error'
  const diagnosticConfirmedMissing = diagnosticStatus === 'success' && diagnostic === null
  const diagnosticUnavailable = diagnosticStatus === 'error' && diagnostic === null
  const companyConfirmedMissing = companyStatus === 'success' && company === null
  const companyUnavailable = companyStatus === 'error' && company === null

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-primary/70">
            Обзор компании
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">
            {company?.name ? `Добро пожаловать, ${company.name}` : 'Добро пожаловать в AIStart360'}
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            {company?.industry
              || (companyConfirmedMissing
                ? 'Данные компании пока не заполнены.'
                : companyUnavailable
                  ? 'Данные компании временно недоступны.'
                  : 'Здесь собраны диагностика, документы и следующие шаги.')}
          </p>
        </div>
        {diagnostic && (
          <Link
            href="/client/point-a"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
          >
            Открыть Точку А
            <span className="material-symbols-outlined text-lg">arrow_forward</span>
          </Link>
        )}
      </section>

      {hasLoadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-amber-400">info</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface">Не все данные удалось обновить</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {[diagnosticError, companyError].filter(Boolean).join(' ')}
              {(diagnostic || company) && ' Последние успешно загруженные данные сохранены.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={isLoading}
            className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-amber-400/30 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/10 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
          >
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
            )}
            {isLoading ? 'Повторяем...' : 'Повторить'}
          </button>
        </div>
      )}

      {diagnosticConfirmedMissing ? (
        <section className="overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-6 md:p-8">
          <div className="max-w-2xl">
            <span className="material-symbols-outlined mb-4 text-4xl text-primary">assignment</span>
            <h2 className="font-headline text-2xl font-bold text-on-surface">Подготовим первую диагностику</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Ответьте на вопросы о компании. После последнего шага вы вернётесь сюда, а результат появится в разделе «Точка А».
            </p>
            <Link
              href="/client/onboarding"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary"
            >
              Начать анкету
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </Link>
          </div>
        </section>
      ) : diagnosticUnavailable ? (
        <section className="rounded-3xl border border-white/[0.08] bg-surface-container-low p-6 md:p-8">
          <span className="material-symbols-outlined mb-4 text-4xl text-on-surface-variant">cloud_off</span>
          <h2 className="font-headline text-2xl font-bold text-on-surface">Диагностика временно недоступна</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            Не удалось проверить, есть ли готовая диагностика. Повторите загрузку — введённые ранее данные не будут сброшены.
          </p>
        </section>
      ) : diagnostic ? (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 md:col-span-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Индекс здоровья</p>
              <div className="mt-3 flex items-end gap-2">
                <span className="font-mono text-5xl font-extrabold text-on-surface">
                  {hasOverallScore ? (overallScore / 10).toFixed(1) : '—'}
                </span>
                <span className="pb-1 text-sm text-on-surface-variant">/ 10</span>
              </div>
              <p className="mt-3 text-xs text-on-surface-variant">
                Стадия: {diagnostic.stage ? STAGE_LABELS[diagnostic.stage] : 'не определена'}
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 md:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-on-surface">Ключевые направления</h2>
                <Link href="/client/point-a" className="text-xs text-primary hover:underline">Подробнее</Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {DOMAIN_LABELS.map((domain) => {
                  const score = diagnostic[domain.key]?.score
                  const hasScore = typeof score === 'number' && Number.isFinite(score)
                  const scoreWidth = hasScore ? Math.min(100, Math.max(0, score)) : 0
                  return (
                    <div key={domain.key} className="flex items-center gap-3 rounded-xl bg-surface-container p-3">
                      <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="truncate text-on-surface-variant">{domain.label}</span>
                          <span className="font-mono font-bold text-on-surface">
                            {hasScore ? (score / 10).toFixed(1) : '—'}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                          {hasScore && (
                            <div className="h-full rounded-full bg-primary" style={{ width: `${scoreWidth}%` }} />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-on-surface">Быстрые действия</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: '/client/point-a', icon: 'my_location', title: 'Точка А', text: 'Подробная диагностика бизнеса' },
            { href: '/client/onboarding/documents', icon: 'upload_file', title: 'Документы', text: 'Загрузить отчёты и материалы' },
            { href: '/client/onboarding', icon: 'edit_note', title: 'Обновить анкету', text: 'Актуализировать данные компании' },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 transition-colors hover:border-primary/25 hover:bg-primary/[0.04]"
            >
              <span className="material-symbols-outlined text-2xl text-primary">{action.icon}</span>
              <h3 className="mt-4 text-sm font-semibold text-on-surface group-hover:text-primary">{action.title}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{action.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
