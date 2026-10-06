'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DataTable, EmptyState, HoverCard, fmtAgo, fmtDateTime, type Column } from '../kit'
import { durationBetween, fmtDuration, fmtUsd, taskStatusMeta, triggerLabel } from './model'
import type { TaskRow } from './types'
import { StatusChip } from './ui'

export function TasksTable({ rows, loading, base, agentNames, hideAgent, onCompany, empty }: {
  rows: TaskRow[] | null | undefined
  loading?: boolean
  base: string
  agentNames?: Record<string, string>
  hideAgent?: boolean
  /** Clicking a company narrows the list to it (tasks page). */
  onCompany?: (c: { id: string; name: string | null }) => void
  empty?: React.ReactNode
}) {
  const router = useRouter()
  const href = (t: TaskRow) => `${base}/agents/tasks/${t.id}`
  const columns: Column<TaskRow>[] = [
    {
      key: 'created',
      header: 'Создана',
      render: (t) => (
        <Link href={href(t)} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-slate-300 hover:text-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" title={fmtDateTime(t.created_at)}>
          {fmtAgo(t.created_at)}
        </Link>
      ),
    },
    ...(hideAgent ? [] : [{
      key: 'agent',
      header: 'Агент',
      render: (t: TaskRow) => (
        <span className="block max-w-[180px] truncate" title={t.agent_key}>
          {agentNames?.[t.agent_key] ?? <span className="font-mono text-[11px]">{t.agent_key}</span>}
        </span>
      ),
    }]),
    {
      key: 'company',
      header: 'Компания',
      render: (t) => !t.company_id ? <span className="text-slate-600">платформа</span> : onCompany ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCompany({ id: t.company_id!, name: t.company_name }) }}
          className="max-w-[180px] truncate text-left text-slate-300 underline decoration-dotted underline-offset-2 hover:text-blue-200"
          title="Показать задачи только этой компании"
        >
          {t.company_name || t.company_id}
        </button>
      ) : <span className="block max-w-[180px] truncate">{t.company_name || t.company_id}</span>,
    },
    { key: 'trigger', header: 'Триггер', render: (t) => <span title={t.trigger_ref ?? undefined}>{triggerLabel(t.trigger)}</span> },
    { key: 'status', header: 'Статус', render: (t) => <StatusChip meta={taskStatusMeta(t.status)} /> },
    { key: 'attempts', header: 'Попытки', className: 'text-right', render: (t) => <span className="font-mono tabular-nums">{t.attempts}/{t.max_attempts}</span> },
    { key: 'cost', header: 'Стоимость', className: 'text-right', render: (t) => <span className="font-mono tabular-nums">{fmtUsd(Number(t.cost_usd))}</span> },
    { key: 'duration', header: 'Длительность', className: 'text-right', render: (t) => <span className="font-mono tabular-nums">{fmtDuration(durationBetween(t.started_at, t.finished_at))}</span> },
    {
      key: 'error',
      header: 'Ошибка',
      render: (t) => !t.last_error_code && !t.last_error ? <span className="text-slate-600">—</span> : (
        <HoverCard
          trigger={<span className="inline-block max-w-[180px] truncate font-mono text-[11px] text-red-300" tabIndex={0}>{t.last_error_code || 'ошибка'}</span>}
          width={360}
        >
          {() => (
            <div className="text-xs">
              <p className="font-mono text-[11px] text-red-300">{t.last_error_code || 'Ошибка'}</p>
              {t.last_error && <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">{t.last_error}</p>}
            </div>
          )}
        </HoverCard>
      ),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(t) => t.id}
      loading={loading}
      onRowClick={(t) => router.push(href(t))}
      empty={empty ?? <EmptyState title="Задач нет" text="Агент ещё ничего не делал по этим условиям." />}
    />
  )
}
