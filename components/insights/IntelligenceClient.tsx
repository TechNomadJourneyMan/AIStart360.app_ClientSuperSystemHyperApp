'use client'

/**
 * /intelligence («Разведка») — readiness of the sources a signal can come from.
 *
 * The screen used to show four tiles: two counts off legacy Prisma tables that
 * are empty in production, a hard-coded `'0'` labelled «AI Инсайты», and a
 * hard-coded `'Active'` labelled «Статус систем» painted with `text-success` —
 * a class that exists in neither tailwind.config.ts nor globals.css, so the
 * green never even rendered. All four are gone.
 *
 * What replaced them is measured, per source, from endpoints that are actually
 * wired: /api/v1/point-a/insights and /api/v1/market-analysis. A source that
 * answers with nothing is reported as empty, with a link to the screen where it
 * gets filled in — never as a zero pretending to be a measurement.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { InsightsEmptyState } from './InsightsEmptyState'
import { useInsightLinks } from './links'
import type { InsightCounts, InsightsApiResponse } from './types'

interface MarketProgress {
  answered: number
  confirmed: number
  total: number
}

interface MarketApiResponse {
  ok: boolean
  error?: string
  data?: { progress: MarketProgress; snapshot: unknown | null }
}

type SourceState =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }

interface SourceRow {
  key: string
  title: string
  icon: string
  state: SourceState
  /** Only real numbers, or an explicit statement that there are none. */
  detail: string
  href: string
  cta: string
  ctaHint: string
}

const STATE_BADGE: Record<SourceState['kind'], { label: string; className: string }> = {
  ok: { label: 'Есть данные', className: 'border-primary/40 bg-primary/10 text-primary' },
  empty: {
    label: 'Пусто',
    className: 'border-tertiary-container/40 bg-tertiary-container/10 text-tertiary-container',
  },
  error: { label: 'Недоступен', className: 'border-error/40 bg-error/10 text-error' },
}

export function IntelligenceClient() {
  const links = useInsightLinks()

  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState<InsightCounts | null>(null)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [market, setMarket] = useState<{ progress: MarketProgress; hasSnapshot: boolean } | null>(
    null
  )
  const [marketError, setMarketError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setInsightsError(null)
    setMarketError(null)

    // Each source is loaded independently: one broken endpoint must not blank
    // out the readiness of the other.
    const [insightsResult, marketResult] = await Promise.allSettled([
      fetch('/api/v1/point-a/insights?limit=1', { cache: 'no-store' }).then(async (res) => {
        const json = (await res.json().catch(() => null)) as InsightsApiResponse | null
        if (!res.ok || !json?.ok || !json.data) {
          throw new Error(json?.error ?? `Ответ ${res.status}`)
        }
        return json.data.counts
      }),
      fetch('/api/v1/market-analysis', { cache: 'no-store' }).then(async (res) => {
        const json = (await res.json().catch(() => null)) as MarketApiResponse | null
        if (!res.ok || !json?.ok || !json.data) {
          throw new Error(json?.error ?? `Ответ ${res.status}`)
        }
        return {
          progress: json.data.progress,
          hasSnapshot: json.data.snapshot !== null && json.data.snapshot !== undefined,
        }
      }),
    ])

    if (insightsResult.status === 'fulfilled') setInsights(insightsResult.value)
    else {
      setInsights(null)
      setInsightsError(
        insightsResult.reason instanceof Error
          ? insightsResult.reason.message
          : 'Источник инсайтов недоступен'
      )
    }

    if (marketResult.status === 'fulfilled') setMarket(marketResult.value)
    else {
      setMarket(null)
      setMarketError(
        marketResult.reason instanceof Error
          ? marketResult.reason.message
          : 'Анкета анализа рынка недоступна'
      )
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows: SourceRow[] = [
    {
      key: 'insights',
      title: 'Инсайты ИИ по Точке А',
      icon: 'auto_awesome',
      state: insightsError
        ? { kind: 'error', message: insightsError }
        : insights && insights.all > 0
          ? { kind: 'ok' }
          : { kind: 'empty' },
      detail: insightsError
        ? insightsError
        : insights && insights.all > 0
          ? `Всего ${insights.all} · от ИИ ${insights.ai} · ждут подтверждения ${insights.pending} · без ответа ${insights.unanswered}`
          : 'В вашей ленте нет ни одного опубликованного инсайта.',
      href: links.insights,
      cta: 'К инсайтам',
      ctaHint: 'Открыть ленту и запустить генерацию',
    },
    {
      key: 'market',
      title: 'Анкета анализа рынка',
      icon: 'public',
      state: marketError
        ? { kind: 'error', message: marketError }
        : market && market.progress.answered > 0
          ? { kind: 'ok' }
          : { kind: 'empty' },
      detail: marketError
        ? marketError
        : market && market.progress.answered > 0
          ? `Заполнено ${market.progress.answered} из ${market.progress.total} вопросов · подтверждено ${market.progress.confirmed} · сводка ${market.hasSnapshot ? 'рассчитана' : 'ещё не рассчитана'}`
          : market
            ? `Не заполнен ни один из ${market.progress.total} вопросов.`
            : 'Данных нет.',
      href: links.market,
      cta: `К разделу «${links.marketLabel}»`,
      ctaHint: links.isOwnerPortal
        ? 'Открыть раздел рынка'
        : 'Заполнить анкету по рынку и конкурентам',
    },
  ]

  const everythingEmpty =
    !loading && rows.every((row) => row.state.kind === 'empty')

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">
            <span className="text-gradient">Разведка</span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-on-surface-variant">
            Готовность источников, из которых собираются сигналы по вашей компании. Показатели по
            всей платформе здесь не выводятся — только ваши данные.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Перепроверить источники сигналов"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-on-surface transition-colors hover:border-primary/40 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            refresh
          </span>
          {loading ? 'Проверяем…' : 'Перепроверить'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Проверка источников">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-container" />
          ))}
        </div>
      ) : everythingEmpty ? (
        <InsightsEmptyState
          icon="sensors"
          title="Сигналов пока нет"
          description="Ни один источник сигналов не заполнен, поэтому разведке не из чего строить выводы."
          missing={[
            'Инсайты ИИ по Точке А — в ленте нет ни одного опубликованного',
            market
              ? `Анкета анализа рынка — не заполнен ни один из ${market.progress.total} вопросов`
              : 'Анкета анализа рынка — данных нет',
          ]}
          actions={[
            {
              href: links.pointA,
              label: 'Заполнить Точку А',
              icon: 'my_location',
              hint: 'Данные анкеты — вход для генерации инсайтов',
              primary: true,
            },
            {
              href: links.market,
              label: links.marketLabel,
              icon: 'public',
              hint: links.isOwnerPortal
                ? 'Раздел рынка в вашем портале'
                : 'Вопросы про нишу, спрос и конкурентов',
            },
            {
              href: links.insights,
              label: 'Инсайты',
              icon: 'lightbulb',
              hint: 'Запустить генерацию по уже заполненным данным',
            },
          ]}
        />
      ) : (
        <section className="space-y-3" aria-label="Источники сигналов">
          {rows.map((row) => {
            const badge = STATE_BADGE[row.state.kind]
            return (
              <article
                key={row.key}
                className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined mt-0.5 text-xl text-primary/60"
                    >
                      {row.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-medium text-on-surface">{row.title}</h2>
                        <span
                          className={`inline-flex items-center rounded-lg border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
                        {row.detail}
                      </p>
                    </div>
                  </div>

                  <Link
                    href={row.href}
                    aria-label={`${row.cta}. ${row.ctaHint}`}
                    className="group inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {row.cta}
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[14px] opacity-50 transition-opacity group-hover:opacity-100"
                    >
                      arrow_forward
                    </span>
                  </Link>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

export default IntelligenceClient
