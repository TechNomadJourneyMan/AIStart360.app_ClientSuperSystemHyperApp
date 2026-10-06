'use client'

/**
 * Staff notification feed (GET /api/giga-admin/notifications): what the
 * platform and its agents reported to the team, with delivery counts and a
 * link to the task / approval / agent. The signed-in staff member links
 * their Telegram here (no separate «my profile» page in GIGA).
 */
import { useState } from 'react'
import Link from 'next/link'
import { Bell, RefreshCw } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { Button, EmptyState, ErrorState, PageHeader, Panel, Select, Skeleton, cx, fmtAgo, fmtDateTime, useGigaQuery } from '../kit'
import { notificationHref, notificationLevelMeta } from './model'
import { TelegramLinkCard } from './TelegramLinkCard'
import type { StaffNotificationRow } from './types'
import { useAgentDirectory } from './useAgentDirectory'
import { Segmented, StatusChip } from './ui'

type Min = 'INFO' | 'WARNING' | 'CRITICAL'
const MIN_OPTIONS: ReadonlyArray<{ value: Min; label: string }> = [
  { value: 'INFO', label: 'Все' },
  { value: 'WARNING', label: 'Внимание и выше' },
  { value: 'CRITICAL', label: 'Критичные и одобрения' },
]
const LIMITS = [{ value: '50', label: '50 последних' }, { value: '100', label: '100 последних' }, { value: '200', label: '200 последних' }] as const

const ACCENT: Record<string, string> = {
  CRITICAL: 'border-l-red-500/70',
  WARNING: 'border-l-amber-500/60',
  APPROVAL_REQUIRED: 'border-l-violet-500/60',
  SUCCESS: 'border-l-emerald-500/50',
  INFO: 'border-l-blue-500/40',
}

export function NotificationsPage() {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const [min, setMin] = useState<Min>('INFO')
  const [limit, setLimit] = useState<(typeof LIMITS)[number]['value']>('50')
  const q = useGigaQuery<{ items: StaffNotificationRow[] }>(`/api/giga-admin/notifications?min=${min}&limit=${limit}`)
  const canAgents = can('agents.view')
  const dir = useAgentDirectory(canAgents)
  const items = q.data?.items ?? []

  return (
    <RequirePermission permission="dashboard.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'Уведомления' }]}
        title="Уведомления"
        description="Что платформа и ИИ-агенты сообщили команде: сбои, критичные риски, завершённые диагностики и запросы на одобрение."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          title="Лента"
          bodyClassName="p-0"
          actions={
            <>
              <Segmented label="Уровень" value={min} options={MIN_OPTIONS} onChange={setMin} />
              <Select label="Сколько показать" value={limit} options={LIMITS} onChange={setLimit} />
            </>
          }
        >
          {q.error && <div className="p-3"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}
          {!q.data && q.loading && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
          {q.data && items.length === 0 && (
            <EmptyState
              icon={<Bell size={18} />}
              title={min === 'INFO' ? 'Уведомлений пока нет' : 'Важных уведомлений нет'}
              text={min === 'INFO' ? 'Здесь появятся сообщения платформы и агентов для команды.' : 'Попробуйте показать все уровни.'}
            />
          )}
          {items.length > 0 && (
            <ul className={cx('divide-y divide-white/[0.04]', q.loading && 'opacity-70')}>
              {items.map((n) => {
                const meta = notificationLevelMeta(n.level)
                const link = canAgents ? notificationHref(n, base) : null
                return (
                  <li key={n.id} className={cx('border-l-2 px-4 py-3', ACCENT[n.level] ?? 'border-l-transparent')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip meta={meta} />
                      <p className="min-w-0 flex-1 text-sm font-medium text-slate-100">{n.title}</p>
                      <time className="text-[10px] text-slate-500" dateTime={n.created_at} title={fmtDateTime(n.created_at)}>{fmtAgo(n.created_at)}</time>
                    </div>
                    {n.body && <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-slate-400">{n.body}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {n.agent_key && <span>агент: {dir.names[n.agent_key] ?? <span className="font-mono">{n.agent_key}</span>}</span>}
                      {n.company_name && <span>клиент: {n.company_name}</span>}
                      <span title="Доставки в Telegram и на почту">
                        доставлено: {n.sent}{n.failed > 0 && <span className="text-red-300"> · ошибок: {n.failed}</span>}
                      </span>
                      <span className="font-mono text-[10px] text-slate-600">{n.type}</span>
                      {link && <Link href={link.href} className="ml-auto text-blue-300 hover:underline">{link.label} →</Link>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <TelegramLinkCard />
        </div>
      </div>
    </RequirePermission>
  )
}
