'use client'

import { Download } from 'lucide-react'
import { Badge, DataTable, EmptyState, ErrorState, Panel, fmtDateTime, useGigaQuery, type Column } from '../kit'

interface Doc { id: string; file_name: string; doc_type: string; file_size: number | null; parse_status: string; uploaded_at: string; download_url: string | null }

const size = (b: number | null) => (!b ? '—' : b < 1024 * 1024 ? `${Math.round(b / 1024)} КБ` : `${(b / 1024 / 1024).toFixed(1)} МБ`)
const PARSE: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  parsed: { label: 'разобран', tone: 'green' }, queued: { label: 'в очереди', tone: 'amber' }, processing: { label: 'обработка', tone: 'amber' }, error: { label: 'ошибка', tone: 'red' },
}

export function DocumentsTab({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: Doc[] }>(`/api/giga-admin/requests/${userId}/documents`)
  const columns: Column<Doc>[] = [
    { key: 'name', header: 'Файл', render: (d) => <span className="text-slate-100">{d.file_name}</span> },
    { key: 'type', header: 'Тип', render: (d) => <Badge>{d.doc_type}</Badge> },
    { key: 'status', header: 'Разбор', render: (d) => <Badge tone={PARSE[d.parse_status]?.tone ?? 'neutral'}>{PARSE[d.parse_status]?.label ?? d.parse_status}</Badge> },
    { key: 'size', header: 'Размер', render: (d) => size(d.file_size) },
    { key: 'at', header: 'Загружен', render: (d) => fmtDateTime(d.uploaded_at) },
    { key: 'dl', header: '', render: (d) => d.download_url ? <a href={d.download_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:underline" onClick={(e) => e.stopPropagation()}><Download size={12} />Открыть</a> : null },
  ]
  return (
    <Panel title="Документы" bodyClassName="p-0">
      {error && <div className="p-3"><ErrorState error={error} onRetry={reload} /></div>}
      <DataTable columns={columns} rows={data?.data} rowKey={(d) => d.id} loading={loading} empty={<EmptyState title="Документов нет" />} />
    </Panel>
  )
}
