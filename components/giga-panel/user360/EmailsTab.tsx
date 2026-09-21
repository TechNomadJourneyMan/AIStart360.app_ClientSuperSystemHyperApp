'use client'

import { Badge, DataTable, EmptyState, ErrorState, Panel, fmtDateTime, useGigaQuery, type Column, type Tone } from '../kit'

/** Что платформа писала клиенту и чем закончилась отправка. */

interface Delivery {
  id: string
  kind: string
  recipient: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  provider_id: string | null
  error: string | null
  created_at: string
}

const KIND: Record<string, string> = {
  portal_invitation: 'Приглашение',
  questionnaire_completed: 'Анкета пройдена',
  survey_reminder: 'Напоминание про анкету',
  gri_completed: 'GRI пройден',
  portal_access_granted: 'Доступ открыт',
  notification: 'Уведомление',
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: 'отправлено', tone: 'green' },
  failed: { label: 'ошибка', tone: 'red' },
  skipped: { label: 'пропущено', tone: 'neutral' },
}

export function EmailsTab({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: Delivery[]; unavailable?: boolean }>(`/api/giga-admin/users/${userId}/emails`)

  const columns: Column<Delivery>[] = [
    { key: 'at', header: 'Когда', render: (d) => <span className="whitespace-nowrap text-slate-400">{fmtDateTime(d.created_at)}</span> },
    { key: 'kind', header: 'Письмо', render: (d) => <span className="text-slate-200">{KIND[d.kind] ?? d.kind}</span> },
    { key: 'subject', header: 'Тема', render: (d) => <span className="text-slate-400">{d.subject}</span> },
    {
      key: 'status', header: 'Результат',
      render: (d) => (
        <span className="flex flex-col gap-1">
          <Badge tone={STATUS[d.status]?.tone}>{STATUS[d.status]?.label ?? d.status}</Badge>
          {d.error && <span className="max-w-[16rem] truncate text-[10px] text-red-300" title={d.error}>{d.error}</span>}
        </span>
      ),
    },
    { key: 'to', header: 'Адрес', render: (d) => <span className="text-[11px] text-slate-500">{d.recipient}</span> },
  ]

  return (
    <Panel
      title="Письма"
      description="История отправок платформы этому клиенту. Тело письма не хранится — только факт, вид и результат."
      bodyClassName="p-0"
    >
      {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
      {data?.unavailable && (
        <p className="m-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Журнал писем недоступен — вероятно, не применена миграция 081.
        </p>
      )}
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(d) => d.id}
        loading={loading}
        empty={<EmptyState title="Писем ещё не было" text="Приглашения, напоминания и уведомления появятся здесь." />}
      />
    </Panel>
  )
}
