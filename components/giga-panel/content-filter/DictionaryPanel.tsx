'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, GigaApiError, Panel, Select, fmtDate, gigaFetch, inputClass, type Column,
} from '@/components/giga-panel/kit'
import type { FilterTerm } from './types'

type Kind = FilterTerm['kind']

export function DictionaryPanel({ terms, error, loading, reload }: {
  terms: FilterTerm[] | null
  error: GigaApiError | null
  loading: boolean
  reload: () => void
}) {
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState<Kind>('block')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [toDelete, setToDelete] = useState<FilterTerm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useState<'all' | Kind>('all')

  const trimmed = term.trim()
  const valid = trimmed.length >= 2 && trimmed.length <= 60

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || adding) return
    setAdding(true)
    try {
      await gigaFetch('/api/giga-admin/content-filter/terms', { method: 'POST', json: { term: trimmed, kind, note: note.trim() || null } })
      toast.success(kind === 'block' ? `«${trimmed}» запрещено` : `«${trimmed}» добавлено в исключения`)
      setTerm('')
      setNote('')
      reload()
    } catch (err) {
      toast.error(err instanceof GigaApiError ? err.message : 'Не удалось добавить слово')
    } finally {
      setAdding(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await gigaFetch('/api/giga-admin/content-filter/terms', { method: 'DELETE', json: { id: toDelete.id } })
      toast.success(`«${toDelete.term}» удалено из словаря`)
      setToDelete(null)
      reload()
    } catch (err) {
      toast.error(err instanceof GigaApiError ? err.message : 'Не удалось удалить слово')
    } finally {
      setDeleting(false)
    }
  }

  const rows = (terms ?? []).filter((t) => view === 'all' || t.kind === view)
  const columns: Column<FilterTerm>[] = [
    { key: 'term', header: 'Слово', render: (t) => <span className="font-mono text-slate-100">{t.term}</span> },
    { key: 'kind', header: 'Тип', render: (t) => t.kind === 'block' ? <Badge tone="red">запрещено</Badge> : <Badge tone="green">исключение</Badge> },
    { key: 'note', header: 'Заметка', className: 'max-w-[18rem]', render: (t) => <span className="line-clamp-2 text-slate-400">{t.note || '—'}</span> },
    { key: 'date', header: 'Добавлено', render: (t) => <span className="whitespace-nowrap text-[11px] text-slate-500">{fmtDate(t.created_at)}</span> },
    { key: 'act', header: '', render: (t) => <Button size="sm" variant="ghost" aria-label={`Удалить «${t.term}»`} icon={<Trash2 size={12} />} onClick={() => setToDelete(t)} /> },
  ]

  return (
    <>
      <Panel
        title="Словарь"
        description="Дополняет встроенные правила. «Запретить» — слово блокируется (совпадение с началом слова). «Исключение» — снимает ложное срабатывание для слов, которые так начинаются."
      >
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
          <Field label="Слово" hint="От 2 до 60 символов, регистр и ё/е не важны">
            <input value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} className={inputClass} placeholder="например, казино" />
          </Field>
          <div className="pb-[18px]">
            <Select<Kind> label="Тип" value={kind} onChange={setKind} options={[{ value: 'block', label: 'Запретить' }, { value: 'allow', label: 'Исключение' }]} />
          </div>
          <Field label="Заметка (необязательно)">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputClass} placeholder="Зачем добавлено" />
          </Field>
          <div className="pb-[18px]">
            <Button type="submit" variant="primary" icon={<Plus size={13} />} loading={adding} disabled={!valid}>Добавить</Button>
          </div>
        </form>
      </Panel>

      <Panel
        className="mt-4"
        bodyClassName="p-0"
        title={`Слова в словаре${terms ? ` · ${terms.length}` : ''}`}
        actions={<Select label="Показать" value={view} onChange={setView} options={[{ value: 'all', label: 'Все' }, { value: 'block', label: 'Запрещённые' }, { value: 'allow', label: 'Исключения' }] as const} />}
      >
        <div className="px-4 pt-3"><ErrorState error={error} onRetry={reload} /></div>
        {!error && (
          <DataTable
            columns={columns}
            rows={terms ? rows : null}
            rowKey={(t) => t.id}
            loading={loading}
            skeletonRows={3}
            empty={<EmptyState title="Словарь пуст" text="Работают только встроенные правила: мат, оскорбления, спам." />}
          />
        )}
      </Panel>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        title="Удалить слово из словаря?"
        text={toDelete ? `«${toDelete.term}» (${toDelete.kind === 'block' ? 'запрещено' : 'исключение'}) перестанет действовать в течение минуты.` : undefined}
        confirmLabel="Удалить"
      />
    </>
  )
}
