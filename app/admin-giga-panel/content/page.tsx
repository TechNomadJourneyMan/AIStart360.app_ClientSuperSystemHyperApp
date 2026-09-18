'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Field, GigaApiError, Modal, PageHeader, Panel, SearchInput, Select, fmtDateTime, gigaFetch, inputClass, useDebounced, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { describeRule } from '@/lib/platform/visibility'
import { CONTENT_STATUS as STATUS } from '@/components/giga-panel/content-status'

interface PageRow { id: string; slug: string; title: string; category: string | null; status: 'draft' | 'published' | 'archived'; visibility: unknown; show_in_nav: boolean; sort_order: number; version: number; updated_at: string; published_at: string | null }

export default function ContentListAdmin() {
  const router = useRouter()
  const { can } = useStaff()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const { data, error, loading, reload } = useGigaQuery<{ data: PageRow[] }>(`/api/giga-admin/content/pages?status=${status}&q=${encodeURIComponent(dq)}`)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const res = await gigaFetch<{ data: PageRow }>('/api/giga-admin/content/pages', { method: 'POST', json: { title } })
      toast.success('Черновик создан')
      router.push(`/admin-giga-panel/content/${res.data.id}`)
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось создать')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<PageRow>[] = [
    { key: 'title', header: 'Страница', render: (p) => <div><p className="font-medium text-slate-100">{p.title}</p><p className="font-mono text-[10px] text-slate-500">/client/content/{p.slug}</p></div> },
    { key: 'status', header: 'Статус', render: (p) => <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge> },
    { key: 'cat', header: 'Раздел', render: (p) => p.category ?? <span className="text-slate-600">—</span> },
    { key: 'vis', header: 'Кто видит', render: (p) => <span className="text-[11px] text-slate-400">{describeRule(p.visibility)}</span> },
    { key: 'nav', header: 'В меню', render: (p) => (p.show_in_nav ? <Badge tone="blue">да · {p.sort_order}</Badge> : <span className="text-slate-600">нет</span>) },
    { key: 'upd', header: 'Изменена', render: (p) => <span className="text-slate-400">{fmtDateTime(p.updated_at)} · v{p.version}</span> },
  ]

  return (
    <RequirePermission permission="content.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Контент и страницы' }]}
        title="Контент и страницы"
        description="Материалы кабинета из блоков: тексты, изображения, видео, документы. Черновик → публикация → архив."
        actions={can('content.edit') ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Новая страница</Button> : undefined}
      />
      <ErrorState error={error} onRetry={reload} />
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Заголовок, адрес, раздел" className="min-w-[220px] flex-1" />
          <Select label="Статус" value={status} onChange={setStatus} options={[{ value: '', label: 'Все статусы' }, { value: 'draft', label: 'Черновики' }, { value: 'published', label: 'Опубликованные' }, { value: 'archived', label: 'Архив' }]} />
        </div>
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(p) => p.id}
          loading={loading}
          onRowClick={(p) => router.push(`/admin-giga-panel/content/${p.id}`)}
          empty={<EmptyState title="Страниц пока нет" text="Создайте первую страницу материалов — она появится у пользователей после публикации." />}
        />
      </Panel>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Новая страница"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Отмена</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={create}>Создать черновик</Button></>}
      >
        <Field label="Заголовок" hint="Адрес страницы сформируется из заголовка, его можно поменять в редакторе.">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} maxLength={200} autoFocus />
        </Field>
      </Modal>
    </RequirePermission>
  )
}
