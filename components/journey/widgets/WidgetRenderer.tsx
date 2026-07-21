'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  CircleDollarSign,
  CircleHelp,
  Database,
  ExternalLink,
  FileText,
  Goal,
  Landmark,
  Megaphone,
  Newspaper,
  PlugZap,
  Route,
  ShieldAlert,
  SquareCheckBig,
  UsersRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneyWidgetKind, JourneyWidgetView } from '../model'

type UnknownRecord = Record<string, unknown>

export const WIDGET_META: Record<
  JourneyWidgetKind,
  { icon: LucideIcon; shortLabel: string }
> = {
  business_passport: { icon: BriefcaseBusiness, shortLabel: 'Паспорт' },
  business_health: { icon: Activity, shortLabel: 'Здоровье' },
  point_b_goals: { icon: Goal, shortLabel: 'Цели' },
  roadmap_actions: { icon: Route, shortLabel: 'Путь' },
  crm_readiness: { icon: Database, shortLabel: 'CRM' },
  sales_funnel: { icon: Landmark, shortLabel: 'Продажи' },
  marketing_growth: { icon: Megaphone, shortLabel: 'Маркетинг' },
  finance_cashflow: { icon: CircleDollarSign, shortLabel: 'Финансы' },
  operations_team: { icon: UsersRound, shortLabel: 'Операции' },
  risks_opportunities: { icon: ShieldAlert, shortLabel: 'Риски' },
  news_digest: { icon: Newspaper, shortLabel: 'Новости' },
  tasks_reminders: { icon: SquareCheckBig, shortLabel: 'Задачи' },
  learning_resources: { icon: BookOpen, shortLabel: 'Материалы' },
  knowledge_base: { icon: FileText, shortLabel: 'Знания' },
  external_sources: { icon: PlugZap, shortLabel: 'Источники' },
  domain_metrics: { icon: Activity, shortLabel: 'Метрики' },
  domain_process: { icon: Route, shortLabel: 'Процесс' },
}

export function WidgetRenderer({ widget }: { widget: JourneyWidgetView }) {
  switch (widget.kind) {
    case 'business_passport':
      return <BusinessPassport data={widget.data} />
    case 'business_health':
      return <BusinessHealth data={widget.data} />
    case 'point_b_goals':
      return <Goals data={widget.data} />
    case 'roadmap_actions':
      return <Roadmap data={widget.data} />
    case 'crm_readiness':
      return <CrmReadiness data={widget.data} />
    case 'sales_funnel':
      return <MetricRows data={widget.data} empty="Добавьте этапы и KPI воронки." />
    case 'marketing_growth':
      return <Marketing data={widget.data} />
    case 'finance_cashflow':
      return <MetricsAndQuestions data={widget.data} empty="Загрузите финансовый отчёт или назовите ключевые цифры." />
    case 'operations_team':
      return <Operations data={widget.data} />
    case 'risks_opportunities':
      return <Risks data={widget.data} />
    case 'news_digest':
      return <VerifiedLinks data={widget.data} kind="news" />
    case 'tasks_reminders':
      return <Tasks data={widget.data} />
    case 'learning_resources':
      return <VerifiedLinks data={widget.data} kind="learning" />
    case 'knowledge_base':
      return <KnowledgeBase data={widget.data} />
    case 'external_sources':
      return <ExternalSources data={widget.data} />
    case 'domain_metrics':
      return <DomainMetrics data={widget.data} />
    case 'domain_process':
      return <DomainProcess data={widget.data} />
  }
}

function BusinessPassport({ data }: { data: UnknownRecord }) {
  const facts = records(data.facts).filter((fact) => fact.status !== 'rejected')
  if (!facts.length) return <EmptyHint>Подтверждённые факты появятся после разговора.</EmptyHint>

  return (
    <dl className="space-y-2">
      {facts.slice(0, 5).map((fact, index) => (
        <div key={string(fact.id) ?? index} className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-0 last:pb-0">
          <dt className="min-w-0 text-xs text-on-surface-variant">
            {string(fact.label) ?? string(fact.key) ?? 'Факт'}
          </dt>
          <dd className="max-w-[58%] text-right text-xs font-medium text-on-surface line-clamp-2">
            {scalar(fact.value) ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function BusinessHealth({ data }: { data: UnknownRecord }) {
  const dimensions = records(data.dimensions)
  if (!dimensions.length) {
    return <EmptyHint>Недостаточно данных для честной оценки. AI запросит недостающие метрики.</EmptyHint>
  }

  return (
    <div className="space-y-3">
      {dimensions.slice(0, 5).map((dimension, index) => {
        const score = number(dimension.score)
        const value = Math.max(0, Math.min(100, score ?? 0))
        return (
          <div key={string(dimension.id) ?? index} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="truncate text-on-surface-variant">{string(dimension.label) ?? 'Область'}</span>
              <span className="tabular-nums text-on-surface">{score === undefined ? 'Нет данных' : `${Math.round(value)}%`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              {score !== undefined && <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />}
            </div>
            {string(dimension.basis) && <p className="text-[10px] text-pretty text-on-surface-variant">{string(dimension.basis)}</p>}
          </div>
        )
      })}
    </div>
  )
}

function Goals({ data }: { data: UnknownRecord }) {
  const goals = records(data.goals)
  if (!goals.length) return <EmptyHint>Опишите измеримый результат и срок в диалоге.</EmptyHint>
  return (
    <div className="space-y-3">
      {[...goals].reverse().slice(0, 4).map((goal, index) => (
        <div key={string(goal.id) ?? index}>
          <p className="text-sm text-pretty text-on-surface">{string(goal.title) ?? 'Цель'}</p>
          <dl className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3 sm:gap-x-2">
            {[
              ['Показатель', scalar(goal.metric) ?? 'Не указан'],
              ['Цель', scalar(goal.target) ?? 'Не указана'],
              ['Срок', scalar(goal.deadline) ?? 'Не указан'],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-on-surface-variant">{label}</dt>
                <dd className="mt-0.5 break-words font-medium text-primary">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function Roadmap({ data }: { data: UnknownRecord }) {
  const items = records(data.items)
  if (!items.length) return <EmptyHint>Путь появится после подтверждения Точки A и цели.</EmptyHint>
  return (
    <ol className="space-y-3">
      {items.slice(0, 4).map((item, index) => (
        <li key={string(item.id) ?? index} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-on-surface">{string(item.title) ?? 'Этап'}</p>
            {string(item.description) && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-pretty text-on-surface-variant">
                {string(item.description)}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-on-surface-variant">
              {string(item.horizon) ?? string(item.period) ?? 'Срок уточняется'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function CrmReadiness({ data }: { data: UnknownRecord }) {
  const status = string(data.connectionStatus) ?? 'unknown'
  const currentTool = string(data.currentTool)
  const hasCrm = typeof data.hasCrm === 'boolean' ? data.hasCrm : null
  const connected = status === 'connected'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {connected ? (
          <BadgeCheck className="size-4 text-primary" aria-hidden />
        ) : (
          <CircleHelp className="size-4 text-tertiary-container" aria-hidden />
        )}
        <span>
          {connected
            ? `CRM указана${currentTool ? `: ${currentTool}` : ''}`
            : hasCrm === false
              ? 'CRM пока нет'
              : hasCrm === true
                ? `CRM есть${currentTool ? `: ${currentTool}` : ''}, но источник не подключён`
                : 'Есть ли у вас CRM?'}
        </span>
      </div>
      {!connected && (
        <p className="text-xs text-pretty text-on-surface-variant">
          {string(data.nextStep) ?? 'После ответа AI сможет предложить корректный следующий шаг. Подключение не выполняется автоматически.'}
        </p>
      )}
    </div>
  )
}

function MetricRows({ data, empty }: { data: UnknownRecord; empty: string }) {
  const metrics = records(data.metrics)
  if (!metrics.length) return <EmptyHint>{empty}</EmptyHint>
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
      {metrics.slice(0, 6).map((metric, index) => (
        <div key={string(metric.id) ?? index} className="min-w-0">
          <dt className="truncate text-[11px] text-on-surface-variant">{string(metric.label) ?? 'Метрика'}</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-on-surface">
            {scalar(metric.value) ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function MetricsAndQuestions({ data, empty }: { data: UnknownRecord; empty: string }) {
  const metrics = records(data.metrics)
  const questions = strings(data.questions)
  if (metrics.length) return <MetricRows data={data} empty={empty} />
  if (!questions.length) return <EmptyHint>{empty}</EmptyHint>
  return <QuestionList items={questions} />
}

function Marketing({ data }: { data: UnknownRecord }) {
  const channels = records(data.channels)
  const opportunities = records(data.opportunities)
  if (!channels.length && !opportunities.length) {
    return <EmptyHint>Назовите активные каналы и их результат — AI найдёт пробелы.</EmptyHint>
  }
  return (
    <div className="space-y-3">
      {!!channels.length && (
        <div className="flex flex-wrap gap-1.5">
          {channels.slice(0, 6).map((channel, index) => (
            <span key={string(channel.id) ?? index} className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-on-surface-variant">
              {string(channel.label) ?? string(channel.name) ?? 'Канал'}
            </span>
          ))}
        </div>
      )}
      {opportunities[0] && (
        <p className="text-xs text-pretty text-on-surface-variant">
          {string(opportunities[0].title)}{string(opportunities[0].detail) ? `: ${string(opportunities[0].detail)}` : ''}
        </p>
      )}
    </div>
  )
}

function Operations({ data }: { data: UnknownRecord }) {
  const signals = records(data.signals)
  const nextQuestion = string(data.nextQuestion)
  if (!signals.length && !nextQuestion) {
    return <EmptyHint>Опишите команду и процесс, который чаще всего задерживает работу.</EmptyHint>
  }
  return (
    <div className="space-y-2">
      {signals.slice(0, 4).map((item, index) => (
        <p key={index} className="flex gap-2 text-xs text-on-surface-variant">
          <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', item.status === 'known' ? 'bg-primary' : 'bg-tertiary-container')} />
          <span>{string(item.title)}{string(item.detail) ? `: ${string(item.detail)}` : ''}</span>
        </p>
      ))}
      {nextQuestion && <QuestionList items={[nextQuestion]} />}
    </div>
  )
}

function Risks({ data }: { data: UnknownRecord }) {
  const risks = records(data.risks)
  const opportunities = records(data.opportunities)
  if (!risks.length && !opportunities.length) {
    return <EmptyHint>Пока нет подтверждённых сигналов для вывода.</EmptyHint>
  }
  return (
    <div className="space-y-3">
      {risks.slice(0, 2).map((item, index) => (
        <p key={`risk-${index}`} className="text-xs text-pretty text-error">Риск: {string(item.title)}{string(item.detail) ? ` — ${string(item.detail)}` : ''}</p>
      ))}
      {opportunities.slice(0, 2).map((item, index) => (
        <p key={`opportunity-${index}`} className="text-xs text-pretty text-primary">Возможность: {string(item.title)}{string(item.detail) ? ` — ${string(item.detail)}` : ''}</p>
      ))}
    </div>
  )
}

function VerifiedLinks({ data, kind }: { data: UnknownRecord; kind: 'news' | 'learning' }) {
  const connected = data.connected === true
  const items = connected ? records(data.items).filter((item) => safeUrl(item.url)) : []
  if (!connected || !items.length) {
    return (
      <EmptyHint>
        {kind === 'news'
          ? 'Новостной источник не подключён. AI не будет придумывать новости.'
          : 'Проверенные материалы пока не найдены. Ссылки без источника не показываются.'}
      </EmptyHint>
    )
  }
  return (
    <div className="space-y-3">
      {items.slice(0, 4).map((item, index) => (
        <a
          key={string(item.id) ?? index}
          href={string(item.url)}
          target="_blank"
          rel="noreferrer"
          className="flex items-start justify-between gap-3 text-xs text-on-surface hover:text-primary"
        >
          <span className="line-clamp-2">{string(item.title) ?? 'Материал'}</span>
          <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        </a>
      ))}
    </div>
  )
}

function Tasks({ data }: { data: UnknownRecord }) {
  const items = records(data.items)
  if (!items.length) return <EmptyHint>Задачи появятся из согласованной дорожной карты.</EmptyHint>
  return (
    <ul className="space-y-2.5">
      {items.slice(0, 5).map((item, index) => (
        <li key={string(item.id) ?? index} className="flex items-start gap-2 text-xs">
          <SquareCheckBig className={cn('mt-0.5 size-3.5 shrink-0', item.done ? 'text-primary' : 'text-on-surface-variant')} aria-hidden />
          <span className={cn('text-pretty', item.done ? 'text-on-surface-variant line-through' : 'text-on-surface')}>
            {string(item.title) ?? string(item.text) ?? 'Задача'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function KnowledgeBase({ data }: { data: UnknownRecord }) {
  const files = records(data.files)
  if (!files.length) {
    return <EmptyHint>Поддерживаются PDF, DOCX, CSV и TXT до 4 МБ. Excel временно отключён проверкой безопасности.</EmptyHint>
  }
  return (
    <ul className="space-y-2">
      {files.slice(0, 5).map((file, index) => (
        <li key={string(file.id) ?? index} className="flex items-center gap-2 text-xs">
          <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-on-surface">{string(file.name) ?? 'Документ'}</span>
          <span className="shrink-0 text-[10px] text-on-surface-variant">
            {string(file.statusLabel) ?? statusLabel(string(file.status))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ExternalSources({ data }: { data: UnknownRecord }) {
  const sources = records(data.sources)
  if (!sources.length) {
    return <EmptyHint>Внешние источники не подключены. Данные остаются в диалоге и загруженных файлах.</EmptyHint>
  }
  return (
    <ul className="space-y-2.5">
      {sources.slice(0, 6).map((source, index) => (
        <li key={string(source.id) ?? index} className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-on-surface">{string(source.label) ?? string(source.name) ?? 'Источник'}</span>
          <span className={source.status === 'connected' ? 'text-primary' : 'text-on-surface-variant'}>
            {source.status === 'connected' ? 'Подключён' : source.status === 'unsupported' ? 'Не поддерживается' : 'Не подключён'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DomainMetrics({ data }: { data: UnknownRecord }) {
  const metrics = records(data.metrics)
  if (!metrics.length) return <EmptyHint>AI ещё не выбрал отраслевые метрики для этого бизнеса.</EmptyHint>
  return (
    <dl className="space-y-2.5">
      {metrics.slice(0, 6).map((metric, index) => {
        const status = string(metric.status) ?? 'unknown'
        const value = scalar(metric.value)
        return (
          <div key={string(metric.id) ?? index} className="border-b border-white/5 pb-2 last:border-0 last:pb-0">
            <div className="flex items-start justify-between gap-3 text-xs">
              <dt className="text-on-surface">{string(metric.label) ?? 'Метрика'}</dt>
              <dd className={cn('shrink-0 text-right tabular-nums', status === 'known' ? 'font-semibold text-primary' : 'text-tertiary-container')}>
                {status === 'known' && value ? value : status === 'assumption' && value ? `${value} · гипотеза` : 'Нужно уточнить'}
              </dd>
            </div>
            {(string(metric.sourceLabel) || string(metric.question)) && (
              <p className="mt-1 text-[10px] text-pretty text-on-surface-variant">
                {string(metric.sourceLabel) ?? string(metric.question)}
              </p>
            )}
          </div>
        )
      })}
      {records(data.guidance).slice(0, 2).map((note, index) => (
        <div key={`guidance-${index}`} className="flex gap-2 pt-1 text-xs text-on-surface-variant">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-tertiary-container" aria-hidden />
          <p className="text-pretty">{string(note.title)}{string(note.detail) ? `: ${string(note.detail)}` : ''}</p>
        </div>
      ))}
    </dl>
  )
}

function DomainProcess({ data }: { data: UnknownRecord }) {
  const stages = records(data.stages)
  if (!stages.length) return <EmptyHint>Опишите ключевой процесс — AI разложит его на проверяемые этапы.</EmptyHint>
  return (
    <ol className="space-y-2.5">
      {stages.slice(0, 7).map((stage, index) => {
        const status = string(stage.status) ?? 'unknown'
        return (
          <li key={string(stage.id) ?? index} className="flex items-start gap-2.5">
            <span className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums',
              status === 'done' || status === 'active' ? 'bg-primary/15 text-primary' : 'bg-tertiary-container/10 text-tertiary-container',
            )}>
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-on-surface">{string(stage.name) ?? 'Этап'}</p>
              <p className="mt-0.5 text-[10px] text-pretty text-on-surface-variant">
                {status === 'done'
                  ? 'Готово'
                  : status === 'active'
                    ? string(stage.nextAction) ?? 'В работе'
                    : status === 'blocked'
                      ? string(stage.nextAction) ?? 'Есть блокер'
                      : string(stage.nextAction) ?? 'Нужно описать текущий процесс'}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-pretty text-on-surface-variant">{children}</p>
}

function QuestionList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.slice(0, 4).map((item, index) => (
        <li key={index} className="flex gap-2 text-xs text-on-surface-variant">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-tertiary-container" aria-hidden />
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function statusLabel(status?: string): string {
  if (status === 'ready') return 'Готов'
  if (status === 'error') return 'Ошибка'
  if (status === 'local-only') return 'Без анализа'
  return 'В обработке'
}
