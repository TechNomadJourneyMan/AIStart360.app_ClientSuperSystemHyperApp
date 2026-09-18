'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Save } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Badge, Button, ErrorState, GigaApiError, PageHeader, Panel, Skeleton, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '@/components/giga-panel/kit'
import { VisibilityEditor } from '@/components/giga-panel/VisibilityEditor'
import type { PlatformSection } from '@/lib/platform/sections'
import type { VisibilityRule } from '@/lib/platform/visibility'

type Row = PlatformSection & { visibility: VisibilityRule }

export default function SectionsPage() {
  const { data, error, reload } = useGigaQuery<{ data: Row[] }>('/api/giga-admin/sections')
  const [rows, setRows] = useState<Row[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data?.data) {
      setRows(data.data.map((r) => ({ ...r, visibility: (r.visibility ?? { audience: 'all' }) as VisibilityRule })))
      setDirty(false)
    }
  }, [data])

  const patch = (key: string, p: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))); setDirty(true) }
  const move = (i: number, d: -1 | 1) => {
    setRows((rs) => {
      const n = [...rs]
      const j = i + d
      if (j < 0 || j >= n.length) return rs
      ;[n[i], n[j]] = [n[j], n[i]]
      return n.map((r, idx) => ({ ...r, sort_order: (idx + 1) * 10 }))
    })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await gigaFetch<{ changed: string[]; note: string }>('/api/giga-admin/sections', {
        method: 'PUT',
        json: { sections: rows.map((r) => ({ key: r.key, title: r.title, description: r.description, enabled: r.enabled, visibility: r.visibility, sort_order: r.sort_order })) },
      })
      toast.success(res.changed.length ? `Сохранено разделов: ${res.changed.length}. ${res.note}` : 'Изменений нет')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <RequirePermission permission="platform.sections">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Разделы и видимость' }]}
        title="Разделы платформы"
        description="Включение, порядок и аудитория разделов кабинета клиента. Выключенный или скрытый раздел исчезает из меню, а прямой переход по ссылке ведёт в «Мой профиль»."
        actions={<Button variant="primary" icon={<Save size={13} />} loading={saving} disabled={!dirty} onClick={save}>Сохранить</Button>}
      />
      <ErrorState error={error} onRetry={reload} />
      {!data ? <Skeleton className="h-96" /> : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <Panel
              key={r.key}
              className={cx(!r.enabled && 'opacity-70')}
              title={<span className="flex flex-wrap items-center gap-2"><span className="material-symbols-outlined text-base text-blue-300" aria-hidden>{r.icon ?? 'widgets'}</span>{r.title}{r.enabled ? <Badge tone="green">включён</Badge> : <Badge tone="red">выключен</Badge>}</span>}
              description={<span className="font-mono">{r.paths.join(', ')}</span>}
              actions={
                <>
                  <Button size="sm" variant="ghost" aria-label="Выше" icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="ghost" aria-label="Ниже" icon={<ArrowDown size={12} />} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.key, { enabled: e.target.checked })} />
                    Включён
                  </label>
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <input value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} className={inputClass} maxLength={80} aria-label="Название раздела" />
                  <input value={r.description ?? ''} onChange={(e) => patch(r.key, { description: e.target.value })} className={inputClass} maxLength={200} aria-label="Описание раздела" placeholder="Описание" />
                  <p className="text-[10px] text-slate-600">Изменён {fmtDateTime(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</p>
                </div>
                <VisibilityEditor value={r.visibility} onChange={(v) => patch(r.key, { visibility: v })} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </RequirePermission>
  )
}
