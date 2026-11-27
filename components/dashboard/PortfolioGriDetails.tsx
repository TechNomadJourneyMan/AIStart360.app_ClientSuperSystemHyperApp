'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { formatGri, griColor, griZone } from '@/lib/format/gri'
import { getClientLocale, type Locale } from '@/lib/i18n/locale'
import type { PortfolioGRI, PortfolioGriDomainKey } from '@/lib/portfolio-gri'

type Domain = { key: PortfolioGriDomainKey; label: string }
type Selection = 'overall' | PortfolioGriDomainKey

interface DetailsProps {
  data: PortfolioGRI
  domains: ReadonlyArray<Domain>
  selection?: Selection
}

const DOMAIN_EN: Record<PortfolioGriDomainKey, string> = {
  product: 'Product and demand', trust: 'Trust and positioning', bizmodel: 'Business model',
  cash: 'Financial stability', ops: 'Operations', team: 'Team', founder: 'Owner readiness',
}

const COPY = {
  ru: {
    title: 'GRI портфеля', details: 'Подробнее', close: 'Закрыть',
    description: 'Из чего складывается индекс и сколько оценок участвует в расчёте.',
    source: 'Источник: актуальные оценки GRI, доступные вашему аккаунту. Для каждого клиента берём одну оценку.',
    reports: 'Оценок с данными', count: 'Участвует оценок', block: 'Раздел', score: 'Индекс',
    noData: 'нет данных', unknown: 'не сохранено', calculation: 'Как рассчитано',
    overallFormula: 'Сумма индексов GRI клиентов ÷ количество заполненных индексов.',
    domainFormula: 'Сумма средних баллов этого раздела у клиентов ÷ количество оценок с заполненным разделом.',
    denominator: 'Делитель в этом расчёте',
    missing: 'Пустые ответы и нулевые значения «не заполнено» исключаются. Поэтому у разделов и общего индекса может быть разное количество оценок.',
    separate: 'Общий индекс портфеля — среднее индексов клиентов. Он не пересчитывается из семи средних баллов портфеля.',
    clientFormula: 'В оценке клиента сначала усредняются заполненные критерии каждого раздела, затем — заполненные разделы. На экране значения округлены до одного знака.',
    legacy: 'В этой сохранённой сводке нет количества ответов по разделам. Общим количеством оценок оно не заменяется.',
    openGri: 'Перейти к GRI', view: 'Подробнее:',
  },
  en: {
    title: 'Portfolio GRI', details: 'Details', close: 'Close',
    description: 'What makes up the index and how many assessments contribute to each calculation.',
    source: 'Source: current GRI assessments visible to your account. One assessment is used per client.',
    reports: 'Assessments with data', count: 'Assessments used', block: 'Section', score: 'Index',
    noData: 'no data', unknown: 'not recorded', calculation: 'Calculation',
    overallFormula: 'Sum of client GRI indices ÷ number of completed indices.',
    domainFormula: 'Sum of clients’ average scores for this section ÷ number of assessments with this section completed.',
    denominator: 'Denominator in this calculation',
    missing: 'Missing answers and zero values meaning “unanswered” are excluded. Sections and the overall index can therefore use different numbers of assessments.',
    separate: 'The overall portfolio index is the average of client indices. It is not recalculated from the seven portfolio section averages.',
    clientFormula: 'A client assessment averages completed criteria within each section, then averages the completed sections. Displayed values are rounded to one decimal place.',
    legacy: 'This saved summary has no section response counts. The total number of assessments is not used as a substitute.',
    openGri: 'Open GRI', view: 'View details:',
  },
} as const

function selectionLabel(selection: Selection, domains: ReadonlyArray<Domain>, locale: Locale) {
  if (selection === 'overall') return COPY[locale].title
  return locale === 'en' ? DOMAIN_EN[selection] : domains.find((d) => d.key === selection)?.label ?? selection
}

function zoneLabel(value: number | null, locale: Locale) {
  const zone = griZone(value)
  if (!zone) return COPY[locale].noData
  if (locale === 'ru') return zone.label
  return { critical: 'Critical', developing: 'Developing', strong: 'Stable', excellent: 'Excellent' }[zone.key]
}

/** Only the aggregate already shown on the dashboard crosses the client boundary. */
export function PortfolioGriDetailsContent({ data, domains, selection = 'overall', locale }: DetailsProps & { locale: Locale }) {
  const t = COPY[locale]
  const score = data[selection]
  const count = data.sampleCounts?.[selection]
  const rows: Array<{ key: Selection; label: string }> = [
    { key: 'overall', label: t.title },
    ...domains.map((d) => ({ key: d.key, label: selectionLabel(d.key, domains, locale) })),
  ]

  return (
    <div className="space-y-5 text-sm text-on-surface-variant">
      <p className="leading-relaxed">{t.source} {t.reports}: {data.reportCount}.</p>
      <section className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4" aria-label={t.calculation}>
        <h3 className="font-medium text-on-surface">{selectionLabel(selection, domains, locale)}</h3>
        <p className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-mono font-bold" style={{ color: score === null ? undefined : griColor(score) }}>
            {formatGri(score, { empty: t.noData })}
          </span>
          {score !== null && <span>/ 10 · {zoneLabel(score, locale)}</span>}
        </p>
        <p className="mt-3 leading-relaxed">{selection === 'overall' ? t.overallFormula : t.domainFormula}</p>
        <p className="mt-2">{t.denominator}: <strong className="text-on-surface">{count ?? t.unknown}</strong>.</p>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t.description}</caption>
          <thead className="text-on-surface-variant/70">
            <tr className="border-b border-white/10">
              <th scope="col" className="py-2 pr-3 font-medium">{t.block}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{t.score}</th>
              <th scope="col" className="py-2 text-right font-medium">{t.count}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`border-b border-white/[0.04] ${row.key === selection ? 'bg-primary/[0.04]' : ''}`}>
                <th scope="row" className="py-2.5 pr-3 font-medium text-on-surface">{row.label}</th>
                <td className="py-2.5 pr-3 font-mono whitespace-nowrap">{formatGri(data[row.key], { scale: true, empty: t.noData })}</td>
                <td className="py-2.5 text-right font-mono">{data.sampleCounts?.[row.key] ?? t.unknown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 text-xs leading-relaxed">
        <p>{t.missing}</p>
        <p>{t.separate}</p>
        <p>{t.clientFormula}</p>
        {!data.sampleCounts && <p>{t.legacy}</p>}
      </div>
    </div>
  )
}

export function PortfolioGriDetails({ data, domains, selection = 'overall', children, className }: DetailsProps & { children?: ReactNode; className?: string }) {
  const [locale, setLocale] = useState<Locale>('ru')
  useEffect(() => { setLocale(getClientLocale()) }, [])
  const t = COPY[locale]

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={className}
          aria-label={`${t.view} ${selectionLabel(selection, domains, locale)}`}
        >
          {children ?? <>{t.details}<span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_forward</span></>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-surface-container-low p-5 shadow-2xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold text-on-surface">{t.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-relaxed text-on-surface-variant">{t.description}</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-on-surface-variant hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40" aria-label={t.close}>
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </Dialog.Close>
          </div>
          <PortfolioGriDetailsContent data={data} domains={domains} selection={selection} locale={locale} />
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm">
            <Link href="/gri" className="rounded-lg text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40">{t.openGri}</Link>
            <Dialog.Close className="rounded-lg border border-white/10 px-3 py-1.5 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40">{t.close}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
