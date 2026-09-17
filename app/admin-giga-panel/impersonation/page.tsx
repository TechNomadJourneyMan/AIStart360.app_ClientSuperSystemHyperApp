'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, ErrorState, GigaApiError, PageHeader, Pagination, Panel, Select, fmtDateTime, gigaFetch, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'

interface Row {
  id: string; admin_id: string; admin_email: string | null; admin_role: string; target_user_id: string; mode: 'view' | 'edit'; reason: string
  started_at: string; expires_at: string; ended_at: string | null; end_reason: string | null; active: boolean
  target: { email: string; full_name: string | null } | null
}

const END: Record<string, string> = {
  exit: 'выход', exit_after_expiry: 'выход после истечения', expired: 'истекла', replaced: 'заменена новой', ended_by_admin: 'завершена в панели',
  terminated: 'прервана администратором', user_archived: 'пользователь в архиве', audit_failed: 'журнал недоступен', link_failed: 'ошибка входа', verify_failed: 'ошибка входа',
}

function Inner() {
  const sp = useSearchParams()
  const ended = sp.get('ended')
  const [page, setPage] = useState(1)
  const [active, setActive] = useState<'0' | '1'>('0')
  const { data, error, loading, reload } = useGigaQuery<{ data: Row[]; total: number; page: number; pageSize: number }>(`/api/giga-admin/impersonation?page=${page}&active=${active}`)
  const [busy, setBusy] = useState<string | null>(null)

  const end = async (id: string) => {
    setBusy(id)
    try {
      await gigaFetch(`/api/giga-admin/impersonation/${id}/end`, { method: 'POST', json: {} })
      toast.success('Сессия завершена')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось завершить')
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Row>[] = [
    { key: 'status', header: 'Статус', render: (r) => r.active ? <Badge tone="amber">открыта</Badge> : <Badge>{END[r.end_reason ?? ''] ?? (r.ended_at ? 'завершена' : 'истекла')}</Badge> },
    { key: 'target', header: 'Пользователь', render: (r) => <Link href={`/admin-giga-panel/users/${r.target_user_id}`} className="text-slate-100 hover:text-blue-300">{r.target?.full_name || r.target?.email || r.target_user_id}</Link> },
    { key: 'admin', header: 'Администратор', render: (r) => <span className="text-slate-300">{r.admin_email || r.admin_id}</span> },
    { key: 'mode', header: 'Режим', render: (r) => <Badge tone={r.mode === 'edit' ? 'red' : 'blue'}>{r.mode === 'edit' ? 'правка' : 'просмотр'}</Badge> },
    { key: 'reason', header: 'Причина', className: 'max-w-[16rem]', render: (r) => <span className="line-clamp-2 text-slate-400">{r.reason}</span> },
    { key: 'time', header: 'Время', render: (r) => <span className="whitespace-nowrap text-[11px] text-slate-400">{fmtDateTime(r.started_at)} → {r.ended_at ? fmtDateTime(r.ended_at) : `до ${fmtDateTime(r.expires_at)}`}</span> },
    { key: 'act', header: '', render: (r) => r.active ? <Button size="sm" variant="danger" loading={busy === r.id} onClick={() => end(r.id)}>Завершить</Button> : <Link className="text-[11px] text-blue-300 hover:underline" href={`/admin-giga-panel/audit?imp=1&target=${r.target_user_id}`}>Действия</Link> },
  ]

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Вход от имени' }]}
        title="Кабинет от имени пользователя"
        description="Каждая сессия: кто, к кому, зачем, в каком режиме и сколько длилась. Открыть кабинет можно из карточки пользователя."
        actions={<Select label="Фильтр" value={active} onChange={(v) => { setActive(v); setPage(1) }} options={[{ value: '0', label: 'Все сессии' }, { value: '1', label: 'Только открытые' }] as const} />}
      />
      {ended && (
        <p className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-2.5 text-xs text-amber-200">
          {ended === 'expired' ? 'Время сессии «от имени» истекло — вы вышли из кабинета пользователя.' : 'Сессия «от имени» была завершена — вы вышли из кабинета пользователя.'}
        </p>
      )}
      <ErrorState error={error} onRetry={reload} />
      <Panel bodyClassName="p-0">
        <DataTable columns={columns} rows={data?.data} rowKey={(r) => r.id} loading={loading} />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Panel>
    </>
  )
}

export default function ImpersonationPage() {
  return (
    <RequirePermission permission="impersonate.view">
      <Suspense fallback={null}><Inner /></Suspense>
    </RequirePermission>
  )
}
