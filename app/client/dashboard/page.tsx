'use client'

import { useEffect, useState } from 'react'
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

export default function ClientDashboardPage() {
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const loadDashboard = async () => {
      setIsLoading(true)
      setHasError(false)

      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user?.id) {
          setHasError(true)
          return
        }

        const [diagnosticResponse, companyResponse] = await Promise.all([
          fetch(`/api/v1/diagnostics/current?user_id=${user.id}`),
          fetch(`/api/v1/onboarding/company?user_id=${user.id}`),
        ])

        const [diagnosticData, companyData] = await Promise.all([
          diagnosticResponse.json(),
          companyResponse.json(),
        ])

        if (diagnosticData.ok) setDiagnostic(diagnosticData.data)
        if (companyData.ok) setCompany(companyData.data)
        if (!diagnosticResponse.ok || !companyResponse.ok) setHasError(true)
      } catch {
        setHasError(true)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboard()
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-sm text-on-surface-variant">Собираем ваш дашборд...</p>
      </div>
    )
  }

  const overallScore = diagnostic?.overall_score ?? 0

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
            {company?.industry || 'Здесь собраны диагностика, документы и следующие шаги.'}
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

      {hasError && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
          <span className="material-symbols-outlined text-amber-400">info</span>
          <div>
            <p className="text-sm font-medium text-on-surface">Не все данные удалось обновить</p>
            <p className="mt-1 text-xs text-on-surface-variant">Обновите страницу или продолжите работу через быстрые действия ниже.</p>
          </div>
        </div>
      )}

      {!diagnostic ? (
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
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 md:col-span-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Индекс здоровья</p>
              <div className="mt-3 flex items-end gap-2">
                <span className="font-mono text-5xl font-extrabold text-on-surface">{(overallScore / 10).toFixed(1)}</span>
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
                  const score = diagnostic[domain.key]?.score ?? 0
                  return (
                    <div key={domain.key} className="flex items-center gap-3 rounded-xl bg-surface-container p-3">
                      <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="truncate text-on-surface-variant">{domain.label}</span>
                          <span className="font-mono font-bold text-on-surface">{(score / 10).toFixed(1)}</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </>
      )}

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
