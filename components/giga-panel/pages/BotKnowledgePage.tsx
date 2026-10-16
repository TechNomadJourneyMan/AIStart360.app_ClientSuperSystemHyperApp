'use client'

/**
 * GIGA-CRM «База знаний бота» (inbox.manage) — the articles the client bot
 * answers from in «Авто» mode (lib/comm/bot.ts). Drafts are invisible to the
 * bot; a published article is found by meaning (embedding) or, without an
 * embedding provider, by words. A file (.txt / .md / .pdf / .docx) becomes a
 * draft article to review and publish.
 */
import { useRef, useState } from 'react'
import { BookOpen, FilePlus2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, PageHeader, SearchInput, Skeleton, Tabs, cx, fmtAgo,
  gigaFetch, GigaApiError, inputClass, useDebounced, useGigaQuery,
} from '@/components/giga-panel/kit'
import type { KbArticleDTO } from '@/lib/comm/kb'

type StatusFilter = 'all' | 'published' | 'draft'
const API = '/api/giga-admin/comm/kb'

interface Draft {
  id: string | null
  title: string
  body: string
  tags: string
  status: 'draft' | 'published'
}

const EMPTY: Draft = { id: null, title: '', body: '', tags: '', status: 'draft' }

function KnowledgeInner() {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 350)
  const list = useGigaQuery<{ data: KbArticleDTO[] }>(`${API}?status=${status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const open = async (id: string) => {
    try {
      const res = await gigaFetch<{ data: KbArticleDTO }>(`${API}/${id}`)
      const a = res.data
      setEditing({ id: a.id, title: a.title, body: a.body ?? '', tags: a.tags.join(', '), status: a.status })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось открыть статью')
    }
  }

  const upload = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    try {
      const res = await gigaFetch<{ data: KbArticleDTO }>(`${API}/upload`, { method: 'POST', body: form })
      toast.success('Файл загружен — проверьте текст и опубликуйте')
      void list.reload()
      const a = res.data
      setEditing({ id: a.id, title: a.title, body: a.body ?? '', tags: a.tags.join(', '), status: a.status })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const rows = list.data?.data ?? []
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'База знаний бота' }]}
        title="База знаний бота"
        description="Статьи, по которым бот отвечает пользователям в режиме «Авто». Черновики бот не видит. Чего нет в базе — бот не выдумывает, а зовёт эксперта."
        actions={
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
            />
            <Button size="sm" icon={<Upload size={13} />} loading={uploading} onClick={() => fileRef.current?.click()}>Загрузить файл</Button>
            <Button size="sm" variant="primary" icon={<FilePlus2 size={13} />} onClick={() => setEditing({ ...EMPTY })}>Новая статья</Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Tabs<StatusFilter>
          value={status}
          onChange={setStatus}
          tabs={[{ key: 'all', label: 'Все' }, { key: 'published', label: 'Опубликованы' }, { key: 'draft', label: 'Черновики' }]}
        />
        <SearchInput className="sm:ml-auto sm:w-72" value={search} onChange={setSearch} placeholder="Заголовок или текст" />
      </div>

      {list.error && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
      {list.loading && !list.data && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
      {list.data && rows.length === 0 && (
        <EmptyState
          icon={<BookOpen size={18} />}
          title={q.trim() ? 'Ничего не нашли' : 'Статей пока нет'}
          text={q.trim() ? 'Попробуйте другой запрос.' : 'Добавьте ответы на частые вопросы: что такое Точка А и GRI, как заполнить анкету, тарифы, как связаться с экспертом. Можно загрузить готовый документ.'}
        />
      )}
      <ul className="space-y-1.5" aria-label="Статьи базы знаний">
        {rows.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => void open(a.id)}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-100">{a.title}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{fmtAgo(a.updatedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {a.status === 'published' ? <Badge tone="green">опубликована</Badge> : <Badge>черновик</Badge>}
                {a.status === 'published' && (a.semantic
                  ? <Badge tone="blue" title="Бот находит статью по смыслу вопроса">поиск по смыслу</Badge>
                  : <Badge tone="amber" title="Эмбеддинг не посчитан (нет провайдера эмбеддингов) — бот находит статью по словам">поиск по словам</Badge>)}
                {a.source === 'file' && <Badge tone="violet">из файла</Badge>}
                {a.tags.slice(0, 6).map((t) => <span key={t} className="text-[10px] text-slate-500">#{t}</span>)}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <ArticleEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => void list.reload()} />
    </>
  )
}

function ArticleEditor({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Draft>(EMPTY)
  const [loadedFor, setLoadedFor] = useState<Draft | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (draft !== loadedFor) {
    setLoadedFor(draft)
    setForm(draft ?? EMPTY)
    setFieldError(null)
  }

  const save = async (status: 'draft' | 'published') => {
    setSaving(status)
    setFieldError(null)
    const payload = {
      title: form.title,
      body: form.body,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20),
      status,
    }
    try {
      const res = await gigaFetch<{ data: KbArticleDTO; embedded?: boolean }>(form.id ? `${API}/${form.id}` : API, {
        method: form.id ? 'PATCH' : 'POST',
        json: payload,
      })
      setForm((f) => ({ ...f, id: res.data.id, status: res.data.status }))
      if (status === 'published') {
        toast.success(res.embedded ? 'Опубликовано — бот уже использует статью' : 'Опубликовано. Поиск по смыслу недоступен (нет провайдера эмбеддингов) — бот найдёт статью по словам')
      } else {
        toast.success('Черновик сохранён — бот его не видит')
      }
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось сохранить'
      if (e instanceof GigaApiError && e.status === 400 && /нецензурн/i.test(msg)) setFieldError(msg)
      toast.error(msg)
    } finally {
      setSaving(null)
    }
  }

  const remove = async () => {
    if (!form.id) return
    setSaving('delete')
    try {
      await gigaFetch(`${API}/${form.id}`, { method: 'DELETE' })
      toast.success('Статья удалена')
      setConfirmDelete(false)
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setSaving(null)
    }
  }

  const valid = form.title.trim().length > 0 && form.body.trim().length > 0
  return (
    <Drawer open={!!draft} onClose={onClose} title={form.id ? 'Статья базы знаний' : 'Новая статья'} width="max-w-2xl">
      <div className="space-y-3">
        <Field label="Заголовок" hint="Как вопрос клиента или тема: «Что такое Точка А», «Как заполнить анкету».">
          <input value={form.title} maxLength={300} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Текст" hint="Факты, которыми бот может отвечать. Пишите так, как ответили бы клиенту.">
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={16}
            maxLength={100_000}
            className={cx(inputClass, 'min-h-[280px] font-mono text-[12px] leading-relaxed')}
          />
        </Field>
        <Field label="Теги" hint="Через запятую: тарифы, анкета, gri.">
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className={inputClass} />
        </Field>
        {fieldError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{fieldError}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          <Button variant="primary" size="sm" disabled={!valid} loading={saving === 'published'} onClick={() => void save('published')}>
            {form.status === 'published' ? 'Сохранить и оставить в работе' : 'Опубликовать'}
          </Button>
          <Button size="sm" disabled={!form.title.trim()} loading={saving === 'draft'} onClick={() => void save('draft')}>
            {form.status === 'published' ? 'Снять с публикации' : 'Сохранить черновик'}
          </Button>
          {form.id && (
            <Button size="sm" variant="danger" className="ml-auto" icon={<Trash2 size={12} />} onClick={() => setConfirmDelete(true)}>Удалить</Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        loading={saving === 'delete'}
        title="Удалить статью?"
        text="Бот перестанет использовать её сразу. Восстановить статью будет нельзя."
        confirmLabel="Удалить"
      />
    </Drawer>
  )
}

export function BotKnowledgePage() {
  return (
    <RequirePermission permission="inbox.manage">
      <KnowledgeInner />
    </RequirePermission>
  )
}
