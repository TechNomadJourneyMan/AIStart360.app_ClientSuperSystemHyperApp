'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, History, ImagePlus, Plus, Save, Trash2, Upload } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, ConfirmDialog, Drawer, ErrorState, Field, GigaApiError, Modal, PageHeader, Panel, Skeleton, Tabs, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery,
} from '@/components/giga-panel/kit'
import { VisibilityEditor } from '@/components/giga-panel/VisibilityEditor'
import { BlockRenderer } from '@/components/content/BlockRenderer'
import { BLOCK_TYPES, type BlockType } from '@/lib/cms/blocks'
import type { VisibilityRule } from '@/lib/platform/visibility'
import { CONTENT_STATUS as STATUS } from '@/components/giga-panel/content-status'

interface EditorBlock { key: string; type: BlockType; content: Record<string, unknown>; hidden: boolean; visibility: VisibilityRule | null }
interface PageData {
  id: string; slug: string; title: string; summary: string | null; category: string | null; icon: string | null; cover_url: string | null
  status: 'draft' | 'published' | 'archived'; visibility: VisibilityRule; show_in_nav: boolean; sort_order: number; version: number
  updated_at: string; published_at: string | null
}
interface Payload {
  data: {
    page: PageData
    blocks: Array<{ id: string; type: BlockType; content: Record<string, unknown>; hidden: boolean; visibility: VisibilityRule | null }>
    revisions: Array<{ id: number; version: number; status: string; created_by: string | null; created_at: string; snapshot: { page: PageData; blocks: Payload['data']['blocks'] } }>
  }
}

const DEFAULT_CONTENT: Record<BlockType, Record<string, unknown>> = {
  heading: { text: 'Новый заголовок', level: 2 },
  text: { text: '' },
  image: { url: '', alt: '', caption: '' },
  video: { url: '', caption: '' },
  document: { url: '', name: '' },
  callout: { tone: 'info', title: '', text: '' },
  cta: { label: 'Перейти', href: '/client/home' },
  divider: {},
}

let seq = 0
const newKey = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`

function MediaPicker({ open, onClose, onPick, accept, canDelete }: { open: boolean; onClose: () => void; onPick: (url: string, name: string) => void; accept: string; canDelete: boolean }) {
  const { data, reload } = useGigaQuery<{ data: Array<{ name: string; title: string; url: string; mime: string | null; size: number | null }> }>(open ? '/api/giga-admin/content/media' : null)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const upload = async (file: File) => {
    // Fail fast: the server rejects these anyway, no need to send megabytes first.
    if (file.size > 25 * 1024 * 1024) { toast.error('Файл больше 25 МБ'); return }
    if (file.size === 0) { toast.error('Файл пустой'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await gigaFetch<{ data: { url: string; name: string } }>('/api/giga-admin/content/media', { method: 'POST', body: fd })
      toast.success('Файл загружен')
      onPick(res.data.url, res.data.name)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось загрузить')
    } finally {
      setUploading(false)
    }
  }
  const [removing, setRemoving] = useState<string | null>(null)
  const removeFile = async (name: string) => {
    if (!window.confirm('Удалить файл из медиатеки? Действие необратимо.')) return
    setRemoving(name)
    try {
      await gigaFetch('/api/giga-admin/content/media', { method: 'DELETE', json: { name } })
      toast.success('Файл удалён')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    } finally {
      setRemoving(null)
    }
  }
  const files = (data?.data ?? []).filter((f) => !accept || (f.mime ?? '').startsWith(accept.split('/')[0]) || accept === '*')
  return (
    <Modal open={open} onClose={onClose} title="Медиатека" wide>
      <div className="mb-4 flex items-center gap-2">
        <input ref={input} type="file" accept={accept === '*' ? undefined : accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        <Button variant="primary" icon={<Upload size={13} />} loading={uploading} onClick={() => input.current?.click()}>Загрузить файл</Button>
        <span className="text-[11px] text-slate-500">PNG, JPG, GIF, WEBP, PDF, MP4, WEBM · до 25 МБ</span>
      </div>
      {files.length === 0 ? <p className="py-6 text-center text-xs text-slate-600">Файлов пока нет</p> : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((f) => (
            <li key={f.url} className="relative">
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Удалить ${f.title}`}
                  disabled={removing === f.name}
                  onClick={() => removeFile(f.name)}
                  className="absolute right-1 top-1 z-10 rounded-md bg-black/70 p-1 text-red-300 hover:text-red-200 disabled:opacity-50"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <button type="button" onClick={() => onPick(f.url, f.title)} className="w-full overflow-hidden rounded-xl border border-white/[0.08] text-left hover:border-blue-500/40">
                {(f.mime ?? '').startsWith('image/')
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.url} alt="" className="aspect-video w-full object-cover" />
                  : <div className="flex aspect-video items-center justify-center bg-white/[0.03] text-[10px] text-slate-400">{f.mime}</div>}
                <p className="truncate px-2 py-1 text-[10px] text-slate-400" title={f.title}>{f.title}{f.size ? ` · ${Math.max(1, Math.round(f.size / 1024))} КБ` : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function BlockFields({ block, onChange, onPickMedia }: { block: EditorBlock; onChange: (c: Record<string, unknown>) => void; onPickMedia: (accept: string, apply: (url: string, name: string) => void) => void }) {
  const c = block.content
  const set = (k: string, v: unknown) => onChange({ ...c, [k]: v })
  const s = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '')
  switch (block.type) {
    case 'heading':
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
          <input value={s('text')} onChange={(e) => set('text', e.target.value)} className={inputClass} placeholder="Заголовок" maxLength={200} />
          <select value={Number(c.level) === 3 ? 3 : 2} onChange={(e) => set('level', Number(e.target.value))} className={inputClass}>
            <option value={2}>Крупный</option><option value={3}>Средний</option>
          </select>
        </div>
      )
    case 'text':
      return (
        <Field label="Текст" hint="Пустая строка — новый абзац. «- » — список, «## » — подзаголовок, **жирный**, [ссылка](https://…)">
          <textarea value={s('text')} onChange={(e) => set('text', e.target.value)} rows={6} className={inputClass} maxLength={20000} />
        </Field>
      )
    case 'image':
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={s('url')} onChange={(e) => set('url', e.target.value)} className={inputClass} placeholder="https://… или выберите в медиатеке" />
            <Button icon={<ImagePlus size={13} />} onClick={() => onPickMedia('image/*', (url) => set('url', url))}>Медиатека</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={s('alt')} onChange={(e) => set('alt', e.target.value)} className={inputClass} placeholder="Описание для незрячих (alt)" maxLength={200} />
            <input value={s('caption')} onChange={(e) => set('caption', e.target.value)} className={inputClass} placeholder="Подпись" maxLength={300} />
          </div>
        </div>
      )
    case 'video':
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={s('url')} onChange={(e) => set('url', e.target.value)} className={inputClass} placeholder="Ссылка YouTube / Vimeo или файл .mp4" />
            <Button icon={<Upload size={13} />} onClick={() => onPickMedia('video/*', (url) => set('url', url))}>Медиатека</Button>
          </div>
          <input value={s('caption')} onChange={(e) => set('caption', e.target.value)} className={inputClass} placeholder="Подпись" maxLength={300} />
        </div>
      )
    case 'document':
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={s('name')} onChange={(e) => set('name', e.target.value)} className={inputClass} placeholder="Название файла" maxLength={200} />
          <input value={s('url')} onChange={(e) => set('url', e.target.value)} className={inputClass} placeholder="https://…" />
          <Button icon={<Upload size={13} />} onClick={() => onPickMedia('application/pdf', (url, name) => onChange({ ...c, url, name: s('name') || name }))}>PDF</Button>
        </div>
      )
    case 'callout':
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <select value={s('tone') || 'info'} onChange={(e) => set('tone', e.target.value)} className={inputClass}>
              <option value="info">Информация</option><option value="success">Успех</option><option value="warning">Внимание</option>
            </select>
            <input value={s('title')} onChange={(e) => set('title', e.target.value)} className={inputClass} placeholder="Заголовок (необязательно)" maxLength={200} />
          </div>
          <textarea value={s('text')} onChange={(e) => set('text', e.target.value)} rows={3} className={inputClass} maxLength={2000} />
        </div>
      )
    case 'cta':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={s('label')} onChange={(e) => set('label', e.target.value)} className={inputClass} placeholder="Текст кнопки" maxLength={80} />
          <input value={s('href')} onChange={(e) => set('href', e.target.value)} className={inputClass} placeholder="/gri или https://…" />
        </div>
      )
    default:
      return <p className="text-[11px] text-slate-600">Горизонтальная линия</p>
  }
}

function Editor({ id }: { id: string }) {
  const router = useRouter()
  const { can } = useStaff()
  const { data, error, reload } = useGigaQuery<Payload>(`/api/giga-admin/content/pages/${id}`)
  const [page, setPage] = useState<PageData | null>(null)
  const [blocks, setBlocks] = useState<EditorBlock[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [picker, setPicker] = useState<{ accept: string; apply: (url: string, name: string) => void } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish' | 'archive' | 'delete'>(null)
  const [busy, setBusy] = useState(false)

  const hydrate = useCallback((p: PageData, bs: Payload['data']['blocks']) => {
    setPage({ ...p, visibility: (p.visibility ?? { audience: 'all' }) as VisibilityRule })
    setBlocks(bs.map((b) => ({ key: b.id ?? newKey(), type: b.type, content: b.content ?? {}, hidden: b.hidden, visibility: b.visibility ?? null })))
    setDirty(false)
  }, [])

  useEffect(() => { if (data?.data) hydrate(data.data.page, data.data.blocks) }, [data, hydrate])

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  const readOnly = !page || !can('content.edit') || (page.status === 'published' && !can('content.publish'))
  const patchPage = (p: Partial<PageData>) => { setPage((cur) => (cur ? { ...cur, ...p } : cur)); setDirty(true) }
  const patchBlock = (key: string, p: Partial<EditorBlock>) => { setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...p } : b))); setDirty(true) }
  const move = (i: number, d: -1 | 1) => { setBlocks((bs) => { const n = [...bs]; const j = i + d; if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n }); setDirty(true) }
  const add = (type: BlockType, at = blocks.length) => { setBlocks((bs) => { const n = [...bs]; n.splice(at, 0, { key: newKey(), type, content: { ...DEFAULT_CONTENT[type] }, hidden: false, visibility: null }); return n }); setDirty(true) }

  const save = async () => {
    if (!page) return
    setSaving(true)
    try {
      const res = await gigaFetch<{ data: PageData }>(`/api/giga-admin/content/pages/${id}`, {
        method: 'PUT',
        json: {
          page: { slug: page.slug, title: page.title, summary: page.summary, category: page.category, icon: page.icon, cover_url: page.cover_url, visibility: page.visibility, show_in_nav: page.show_in_nav, sort_order: page.sort_order },
          blocks: blocks.map((b) => ({ type: b.type, content: b.content, hidden: b.hidden, visibility: b.visibility })),
          expectedVersion: page.version,
        },
      })
      setPage((cur) => (cur ? { ...cur, ...res.data } : cur))
      setDirty(false)
      toast.success(page.status === 'published' ? 'Сохранено — изменения уже видны пользователям' : 'Черновик сохранён')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (status: 'draft' | 'published' | 'archived') => {
    setBusy(true)
    try {
      if (dirty) await save()
      await gigaFetch(`/api/giga-admin/content/pages/${id}/status`, { method: 'POST', json: { status } })
      toast.success(status === 'published' ? 'Опубликовано' : status === 'archived' ? 'Отправлено в архив' : 'Снято с публикации')
      setConfirm(null)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить статус')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/content/pages/${id}`, { method: 'DELETE', json: {} })
      toast.success('Страница удалена')
      router.push('/admin-giga-panel/content')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
      setBusy(false)
    }
  }

  const previewBlocks = useMemo(() => blocks.filter((b) => !b.hidden).map((b) => ({ id: b.key, type: b.type, content: b.content })), [blocks])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!page) return <Skeleton className="h-96" />

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Контент', href: '/admin-giga-panel/content' }, { label: page.title }]}
        title={<span className="flex flex-wrap items-center gap-2">{page.title}<Badge tone={STATUS[page.status].tone}>{STATUS[page.status].label}</Badge>{dirty && <Badge tone="amber">есть несохранённые правки</Badge>}</span>}
        description={`v${page.version} · изменено ${fmtDateTime(page.updated_at)}${page.published_at ? ` · опубликовано ${fmtDateTime(page.published_at)}` : ''}`}
        actions={
          <>
            <Button variant="ghost" icon={<History size={13} />} onClick={() => setHistoryOpen(true)}>Версии</Button>
            {!readOnly && <Button variant="primary" icon={<Save size={13} />} loading={saving} disabled={!dirty} onClick={save}>Сохранить</Button>}
            {can('content.publish') && page.status !== 'published' && <Button variant="secondary" onClick={() => setConfirm('publish')}>Опубликовать</Button>}
            {can('content.publish') && page.status === 'published' && <Button variant="warning" onClick={() => setConfirm('unpublish')}>Снять с публикации</Button>}
            {can('content.publish') && page.status !== 'archived' && <Button variant="ghost" onClick={() => setConfirm('archive')}>В архив</Button>}
            {can('content.publish') && page.status !== 'published' && <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirm('delete')}>Удалить</Button>}
          </>
        }
      />
      {readOnly && <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">Только просмотр: опубликованную страницу меняет роль с правом публикации.</p>}

      <Tabs className="mb-4" value={view} onChange={setView} tabs={[{ key: 'edit', label: 'Редактор' }, { key: 'preview', label: 'Предпросмотр' }]} />

      {view === 'preview' ? (
        <div className="rounded-3xl border border-white/[0.08] bg-[#0A0B0F] px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-3xl">
            {page.category && <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-300/80">{page.category}</p>}
            <h1 className="mt-1 text-3xl font-black text-slate-100">{page.title}</h1>
            {page.summary && <p className="mt-2 text-slate-400">{page.summary}</p>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {page.cover_url && <img src={page.cover_url} alt="" className="mt-6 w-full rounded-3xl object-cover" />}
            <div className="mt-8"><BlockRenderer blocks={previewBlocks} /></div>
            <p className="mt-8 text-center text-[11px] text-slate-600">Так страница выглядит у пользователя. Скрытые блоки не показаны.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            {blocks.length === 0 && (
              <Panel><p className="py-6 text-center text-xs text-slate-500">Добавьте первый блок ниже.</p></Panel>
            )}
            {blocks.map((b, i) => (
              <Panel
                key={b.key}
                className={cx(b.hidden && 'opacity-60')}
                title={<span className="flex items-center gap-2">{BLOCK_TYPES[b.type]}{b.hidden && <Badge>скрыт</Badge>}{b.visibility && b.visibility.audience !== 'all' && <Badge tone="violet">видимость</Badge>}</span>}
                actions={!readOnly && (
                  <>
                    <Button size="sm" variant="ghost" aria-label="Выше" icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" aria-label="Ниже" icon={<ArrowDown size={12} />} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" aria-label="Дублировать" icon={<Copy size={12} />} onClick={() => { setBlocks((bs) => { const n = [...bs]; n.splice(i + 1, 0, { ...b, key: newKey(), content: { ...b.content } }); return n }); setDirty(true) }} />
                    <Button size="sm" variant="ghost" aria-label={b.hidden ? 'Показать' : 'Скрыть'} icon={b.hidden ? <Eye size={12} /> : <EyeOff size={12} />} onClick={() => patchBlock(b.key, { hidden: !b.hidden })} />
                    <Button size="sm" variant="ghost" aria-label="Удалить блок" icon={<Trash2 size={12} />} onClick={() => { setBlocks((bs) => bs.filter((x) => x.key !== b.key)); setDirty(true) }} />
                  </>
                )}
              >
                <fieldset disabled={readOnly} className="space-y-3">
                  <BlockFields block={b} onChange={(content) => patchBlock(b.key, { content })} onPickMedia={(accept, apply) => setPicker({ accept, apply })} />
                  <details className="rounded-lg border border-white/[0.05] px-2 py-1.5">
                    <summary className="cursor-pointer text-[11px] text-slate-500">Кому показывать этот блок</summary>
                    <div className="pt-2">
                      <VisibilityEditor
                        compact
                        value={b.visibility ?? { audience: 'all' }}
                        onChange={(v) => patchBlock(b.key, { visibility: v.audience === 'all' ? null : v })}
                      />
                    </div>
                  </details>
                </fieldset>
              </Panel>
            ))}
            {!readOnly && (
              <Panel title="Добавить блок">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(BLOCK_TYPES) as BlockType[]).map((t) => (
                    <Button key={t} size="sm" icon={<Plus size={12} />} onClick={() => add(t)}>{BLOCK_TYPES[t]}</Button>
                  ))}
                </div>
              </Panel>
            )}
          </div>

          <div className="space-y-4">
            <Panel title="Страница">
              <fieldset disabled={readOnly} className="space-y-3">
                <Field label="Заголовок"><input value={page.title} onChange={(e) => patchPage({ title: e.target.value })} className={inputClass} maxLength={200} /></Field>
                <Field label="Адрес" hint={`/client/content/${page.slug}`}><input value={page.slug} onChange={(e) => patchPage({ slug: e.target.value.toLowerCase() })} className={`${inputClass} font-mono`} maxLength={80} /></Field>
                <Field label="Краткое описание"><textarea value={page.summary ?? ''} onChange={(e) => patchPage({ summary: e.target.value })} rows={3} className={inputClass} maxLength={500} /></Field>
                <Field label="Раздел (группа в списке)"><input value={page.category ?? ''} onChange={(e) => patchPage({ category: e.target.value })} className={inputClass} maxLength={60} placeholder="Например: Обучение" /></Field>
                <Field label="Иконка" hint="Имя Material Symbol, напр. school, article, play_circle"><input value={page.icon ?? ''} onChange={(e) => patchPage({ icon: e.target.value })} className={`${inputClass} font-mono`} maxLength={40} /></Field>
                <Field label="Обложка">
                  <div className="flex gap-2">
                    <input value={page.cover_url ?? ''} onChange={(e) => patchPage({ cover_url: e.target.value })} className={inputClass} placeholder="https://…" />
                    <Button icon={<ImagePlus size={13} />} onClick={() => setPicker({ accept: 'image/*', apply: (url) => patchPage({ cover_url: url }) })} aria-label="Выбрать обложку" />
                  </div>
                </Field>
              </fieldset>
            </Panel>
            <Panel title="Меню и порядок">
              <fieldset disabled={readOnly} className="space-y-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={page.show_in_nav} onChange={(e) => patchPage({ show_in_nav: e.target.checked })} />
                  Показывать в «Моём профиле» (блок «Материалы»)
                </label>
                <Field label="Порядок (меньше — выше)"><input type="number" min={0} max={10000} value={page.sort_order} onChange={(e) => patchPage({ sort_order: Math.max(0, Math.min(10000, Number(e.target.value) || 0)) })} className={inputClass} /></Field>
              </fieldset>
            </Panel>
            <Panel title="Кто видит страницу">
              <fieldset disabled={readOnly}>
                <VisibilityEditor value={page.visibility} onChange={(v) => patchPage({ visibility: v })} compact />
              </fieldset>
            </Panel>
          </div>
        </div>
      )}

      <MediaPicker
        open={!!picker}
        accept={picker?.accept ?? '*'}
        canDelete={can('content.publish')}
        onClose={() => setPicker(null)}
        onPick={(url, name) => { picker?.apply(url, name); setPicker(null) }}
      />

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Версии страницы">
        {!data?.data.revisions.length ? <p className="text-xs text-slate-500">Предыдущих версий нет — они появятся после первого сохранения.</p> : (
          <ul className="space-y-2">
            {data.data.revisions.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-xs">
                <div>
                  <p className="text-slate-200">Версия {r.version} · {STATUS[r.status as keyof typeof STATUS]?.label ?? r.status}</p>
                  <p className="text-[10px] text-slate-500">{fmtDateTime(r.created_at)} · {r.created_by}</p>
                </div>
                {!readOnly && (
                  <Button size="sm" onClick={() => {
                    const snap = r.snapshot
                    hydrate({ ...snap.page, version: page.version, status: page.status, updated_at: page.updated_at, published_at: page.published_at }, snap.blocks)
                    setDirty(true)
                    setHistoryOpen(false)
                    toast.info('Версия загружена в редактор. Проверьте и нажмите «Сохранить».')
                  }}>Восстановить</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirm === 'publish'}
        onClose={() => setConfirm(null)}
        tone="primary"
        title="Опубликовать страницу?"
        text={dirty ? 'Несохранённые правки будут сохранены и опубликованы.' : 'Страница станет доступна пользователям согласно правилам видимости.'}
        confirmLabel="Опубликовать"
        loading={busy}
        onConfirm={() => setStatus('published')}
      />
      <ConfirmDialog open={confirm === 'unpublish'} onClose={() => setConfirm(null)} tone="warning" title="Снять с публикации?" text="Страница перестанет быть видна пользователям и вернётся в черновики." confirmLabel="Снять" loading={busy} onConfirm={() => setStatus('draft')} />
      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} tone="warning" title="Отправить в архив?" text="Страница скроется у пользователей. Её можно вернуть в черновики." confirmLabel="В архив" loading={busy} onConfirm={() => setStatus('archived')} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Удалить страницу навсегда?" text="Страница и все её версии будут удалены. Копия сохранится в журнале аудита." confirmLabel="Удалить" requireText="УДАЛИТЬ" loading={busy} onConfirm={remove} />
    </div>
  )
}

export default function ContentEditorPage({ params }: { params: { id: string } }) {
  return (
    <RequirePermission permission="content.view">
      <Editor id={params.id} />
    </RequirePermission>
  )
}
