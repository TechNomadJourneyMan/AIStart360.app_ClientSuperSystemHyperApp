'use client'

/**
 * «События платформы» — the platform_events outbox that drives agent
 * subscriptions and staff notifications. Filters by event (Russian labels from
 * the API) and company; shows whether each event was dispatched and why not.
 */
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Clock, RefreshCw, XCircle, Zap } from 'lucide-react'
import { RequirePermission } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel, Select, Skeleton, fmtAgo, fmtDateTime, useGigaQuery } from '../kit'
import { PLATFORM_EVENT_LABELS } from '@/lib/events/platform-names'
import { CompanyPicker } from './CompanyPicker'
import { prettyJson, shortActor } from './model'
import type { EventsResponse, PlatformEventRow } from './types'
import { ChipFilter, JsonDetails, Mono, useNow } from './ui'

type Delivery = '' | 'pending' | 'error'
const LIMITS = [{ value: '100', label: '100 последних' }, { value: '200', label: '200 последних' }, { value: '500', label: '500 последних' }] as const
/** The monitoring agent flags events not dispatched within 5 minutes. */
const STALE_MS = 5 * 60_000

export function PlatformEventsPage() {
  const { base } = useWorkspace()
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? `${base}/agents/events`
  const now = useNow(60_000)
  const name = sp.get('name') ?? ''
  const companyId = sp.get('company') ?? ''
  const companyName = sp.get('cname')
  const limit = (['100', '200', '500'] as const).find((l) => l === sp.get('limit')) ?? '100'
  const rawDelivery = sp.get('delivery')
  const delivery: Delivery = rawDelivery === 'pending' || rawDelivery === 'error' ? rawDelivery : ''

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const qs = new URLSearchParams({ limit })
  if (name) qs.set('name', name)
  if (companyId) qs.set('company', companyId)
  const q = useGigaQuery<EventsResponse>(`/api/giga-admin/agents/events?${qs}`)
  const labels: Record<string, string> = q.data?.labels ?? PLATFORM_EVENT_LABELS
  const nameOptions = [{ value: '', label: 'Все события' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]

  const items = q.data?.items ?? []
  const pendingCount = items.filter((e) => !e.dispatched_at).length
  const errorCount = items.filter((e) => !!e.dispatch_error).length
  const shown = delivery === 'pending' ? items.filter((e) => !e.dispatched_at) : delivery === 'error' ? items.filter((e) => !!e.dispatch_error) : items
  const filtered = !!(name || companyId || delivery)

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты', href: `${base}/agents` }, { label: 'События платформы' }]}
        title="События платформы"
        description="Журнал доменных событий: на них подписаны агенты и уведомления персоналу. Недоставленное событие значит, что подписчики его ещё не получили."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      />
      <Panel bodyClassName="p-0">
        <div className="space-y-3 border-b border-white/[0.06] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Событие" value={name} options={nameOptions} onChange={(v) => setParams({ name: v || null })} />
            <Select label="Сколько показать" value={limit} options={LIMITS} onChange={(v) => setParams({ limit: v === '100' ? null : v })} />
            <div className="min-w-[240px] flex-1 sm:max-w-sm">
              <CompanyPicker compact label="Фильтр по компании" value={companyId ? { id: companyId, name: companyName } : null} onChange={(c) => setParams({ company: c?.id ?? null, cname: c?.name ?? null })} />
            </div>
            {filtered && <Button size="sm" variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>Сбросить</Button>}
          </div>
          <ChipFilter
            label="Доставка"
            value={delivery}
            onChange={(v) => setParams({ delivery: v || null })}
            options={[
              { value: '', label: q.data ? `Все (${items.length})` : 'Все' },
              { value: 'pending', label: q.data ? `Не доставлены (${pendingCount})` : 'Не доставлены' },
              { value: 'error', label: q.data ? `С ошибкой (${errorCount})` : 'С ошибкой' },
            ]}
          />
        </div>

        {q.error && <div className="p-3"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}
        {!q.data && q.loading && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {q.data && shown.length === 0 && (
          filtered
            ? <EmptyState icon={<Zap size={18} />} title="Событий по этим условиям нет" text={delivery ? 'Среди загруженных событий таких нет — это хороший знак.' : 'Измените фильтры.'} />
            : <EmptyState icon={<Zap size={18} />} title="Событий ещё не было" text="События появятся, когда клиенты заполнят анкету, загрузят файлы или агенты завершат работу." />
        )}
        {shown.length > 0 && (
          <ul className={q.loading ? 'divide-y divide-white/[0.04] opacity-70' : 'divide-y divide-white/[0.04]'}>
            {shown.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                label={labels[e.name] ?? e.name}
                base={base}
                now={now}
                onCompany={(id) => setParams({ company: id, cname: null })}
              />
            ))}
          </ul>
        )}
        {q.data && items.length >= Number(limit) && (
          <p className="px-4 py-3 text-[11px] text-slate-500">Показаны {limit} последних событий. Увеличьте лимит или сузьте фильтр, чтобы увидеть более ранние.</p>
        )}
      </Panel>
    </RequirePermission>
  )
}

function subjectHref(e: PlatformEventRow, base: string): string | null {
  if (!e.subject_id) return null
  if (e.subject_type === 'agent_task') return `${base}/agents/tasks/${encodeURIComponent(e.subject_id)}`
  if (e.subject_type === 'agent_approval') return `${base}/agents/approvals?focus=${encodeURIComponent(e.subject_id)}`
  return null
}

function EventRow({ e, label, base, now, onCompany }: { e: PlatformEventRow; label: string; base: string; now: Date; onCompany: (id: string) => void }) {
  const stale = !e.dispatched_at && now.getTime() - new Date(e.created_at).getTime() > STALE_MS
  const href = subjectHref(e, base)
  return (
    <li className="grid gap-2 px-4 py-2.5 md:grid-cols-[8.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,11rem)] md:gap-3">
      <time className="text-[11px] text-slate-500" dateTime={e.created_at} title={fmtDateTime(e.created_at)}>{fmtDateTime(e.created_at)}</time>
      <div className="min-w-0">
        <p className="text-xs text-slate-100">{label} <Mono className="ml-1 text-[10px] text-slate-600">{e.name}</Mono></p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {e.company_id ? (
            <button type="button" onClick={() => onCompany(e.company_id!)} className="font-mono text-[10px] underline decoration-dotted underline-offset-2 hover:text-slate-300" title="Показать события этой компании">
              компания {e.company_id}
            </button>
          ) : 'платформа'}
          {e.actor && <span className="ml-2">· {shortActor(e.actor)}</span>}
        </p>
        {prettyJson(e.payload) !== '—' && <div className="mt-1"><JsonDetails value={e.payload} label="данные события" /></div>}
      </div>
      <div className="min-w-0 text-[11px] text-slate-400">
        {e.subject_type || e.subject_id ? (
          href
            ? <Link href={href} className="text-blue-300 hover:underline">{e.subject_type}</Link>
            : <span>{e.subject_type ?? 'объект'}</span>
        ) : <span className="text-slate-600">—</span>}
        {e.subject_id && <Mono className="block truncate text-[10px] text-slate-600">{e.subject_id}</Mono>}
      </div>
      <div className="text-[11px]">
        {e.dispatched_at ? (
          <Badge tone="green" title={fmtDateTime(e.dispatched_at)}><CheckCircle2 size={10} /> доставлено {fmtAgo(e.dispatched_at)}</Badge>
        ) : (
          <Badge tone={stale ? 'red' : 'amber'} title={stale ? 'Не доставлено дольше 5 минут — проверьте Inngest / cron' : 'Ожидает рассылки'}>
            <Clock size={10} /> {stale ? 'не доставлено > 5 мин' : 'ожидает рассылки'}
          </Badge>
        )}
        {e.dispatch_error && (
          <p className="mt-1 flex items-start gap-1 break-words text-red-300"><XCircle size={11} className="mt-0.5 shrink-0" /> {e.dispatch_error}</p>
        )}
      </div>
    </li>
  )
}
