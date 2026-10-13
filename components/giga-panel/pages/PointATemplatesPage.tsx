'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, GigaApiError, Modal, PageHeader, Panel, Skeleton, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery,
} from '@/components/giga-panel/kit'

/**
 * GIGA-CRM «Шаблоны Точки А» (право pointa.templates): библиотека из 7 блоков
 * и отраслевые шаблоны — какие блоки входят в Точку А и с каким весом.
 * Компания берёт шаблон по отрасли (подстроки companies.industry) или явно,
 * если эксперт выбрал его в карточке клиента. Изменение шаблона пересчитывает
 * Точку А всех компаний, которые им пользуются.
 */

type BlockKey = 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy' | 'team' | 'product'
interface TemplateBlock { key: BlockKey; weight: number; enabled: boolean }
interface Template {
  key: string; title: string; industries: string[]; blocks: TemplateBlock[]; version: number; updatedAt: string | null
  usage: { explicit: number; auto: number } | null
}
interface LibraryBlock { key: BlockKey; title: string; description: string; metrics: Array<{ id: string; label: string }> }
interface Payload { data: { templates: Template[]; library: LibraryBlock[] } }

interface Draft { key: string; title: string; industries: string; blocks: TemplateBlock[] }

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

/** Shares of the enabled blocks (what the engine does with the weights). */
function normalised(blocks: TemplateBlock[]): Record<string, number> {
  const total = blocks.filter((b) => b.enabled).reduce((s, b) => s + Math.max(0, b.weight), 0)
  const out: Record<string, number> = {}
  for (const b of blocks) out[b.key] = b.enabled && total > 0 ? Math.max(0, b.weight) / total : 0
  return out
}

function emptyDraft(library: LibraryBlock[]): Draft {
  return { key: '', title: '', industries: '', blocks: library.map((b) => ({ key: b.key, weight: Math.round((1 / library.length) * 100) / 100, enabled: true })) }
}

function draftOf(t: Template, library: LibraryBlock[]): Draft {
  return {
    key: t.key, title: t.title, industries: t.industries.join(', '),
    blocks: library.map((l) => t.blocks.find((b) => b.key === l.key) ?? { key: l.key, weight: 0, enabled: false }),
  }
}

export function PointATemplatesPage() {
  const { base, label } = useWorkspace()
  const { data, error, loading, reload } = useGigaQuery<Payload>('/api/giga-admin/point-a/templates')
  const d = data?.data
  const library = useMemo(() => d?.library ?? [], [d?.library])
  const titleOf = (k: string) => library.find((l) => l.key === k)?.title ?? k

  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; draft: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState(false)

  const save = async () => {
    if (!editing) return
    const { mode, draft } = editing
    const body = {
      title: draft.title.trim(),
      industries: draft.industries.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      blocks: draft.blocks.map((b) => ({ key: b.key, weight: Number(b.weight) || 0, enabled: b.enabled })),
    }
    setSaving(true)
    try {
      const res = await gigaFetch<{ data: { recalc?: { affected: number; queued: number } } }>(
        mode === 'create' ? '/api/giga-admin/point-a/templates' : `/api/giga-admin/point-a/templates/${encodeURIComponent(draft.key)}`,
        { method: mode === 'create' ? 'POST' : 'PUT', json: mode === 'create' ? { key: draft.key.trim(), ...body } : body },
      )
      const n = res.data.recalc?.affected ?? 0
      toast.success(mode === 'create' ? 'Шаблон создан' : 'Шаблон сохранён', { description: n ? `Точка А пересчитается у компаний: ${n}` : undefined })
      setEditing(null)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить шаблон')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await gigaFetch(`/api/giga-admin/point-a/templates/${encodeURIComponent(toDelete.key)}`, { method: 'DELETE' })
      toast.success('Шаблон удалён')
      setToDelete(null)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить шаблон')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <RequirePermission permission="pointa.templates">
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Шаблоны Точки А' }]}
        title="Шаблоны Точки А"
        description="Какие блоки входят в Точку А и с каким весом — по отраслям. Компания получает шаблон по своей отрасли или тот, что выбрал эксперт; изменение шаблона пересчитывает её балл."
        actions={d && <Button variant="primary" icon={<Plus size={13} />} onClick={() => setEditing({ mode: 'create', draft: emptyDraft(library) })}>Новый шаблон</Button>}
      />
      <ErrorState error={error} onRetry={reload} />
      {!d ? (loading ? <Skeleton className="h-80" /> : null) : (
        <div className="space-y-4">
          <Panel title="Шаблоны" description="Отрасль подбирается по подстроке в поле «отрасль» компании; «Универсальный» — для всех остальных.">
            {!d.templates.length ? (
              <EmptyState title="Шаблонов нет" text="Создайте первый шаблон — до этого Точка А считается по встроенному универсальному." />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {d.templates.map((t) => {
                  const shares = normalised(t.blocks)
                  return (
                    <div key={t.key} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100">{t.title}</p>
                          <p className="font-mono text-[10px] text-slate-500">{t.key} · v{t.version}{t.updatedAt ? ` · ${fmtDateTime(t.updatedAt)}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" icon={<Pencil size={12} />} onClick={() => setEditing({ mode: 'edit', draft: draftOf(t, library) })}>Изменить</Button>
                          {t.key !== 'default' && (
                            <Button size="sm" variant="danger" icon={<Trash2 size={12} />} aria-label={`Удалить шаблон ${t.title}`} onClick={() => setToDelete(t)} />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.key === 'default' ? <Badge tone="blue">все остальные отрасли</Badge> : t.industries.length
                          ? t.industries.map((i) => <Badge key={i}>{i}</Badge>)
                          : <Badge tone="amber">без отраслей — только явный выбор эксперта</Badge>}
                      </div>
                      {t.usage && (
                        <p className="mt-2 text-[11px] text-slate-500">Компаний: по отрасли {t.usage.auto}, выбрано экспертом {t.usage.explicit}</p>
                      )}
                      <ul className="mt-2 space-y-1">
                        {library.map((l) => (
                          <li key={l.key} className="flex items-center gap-2 text-[11px]">
                            <span className={cx('w-24 shrink-0', shares[l.key] ? 'text-slate-300' : 'text-slate-600 line-through')}>{l.title}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                              <span className="block h-full rounded-full bg-blue-400/70" style={{ width: `${Math.round((shares[l.key] ?? 0) * 100)}%` }} />
                            </span>
                            <span className="w-12 text-right tabular-nums text-slate-400">{shares[l.key] ? pct(shares[l.key]) : '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel title="Библиотека блоков" description="7 блоков Точки А: что в них оценивается и какие метрики показываются">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {library.map((l) => (
                <div key={l.key} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-sm font-semibold text-slate-200">{l.title} <span className="font-mono text-[10px] font-normal text-slate-600">{l.key}</span></p>
                  <p className="mt-1 text-xs text-slate-400">{l.description}</p>
                  {l.metrics.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">{l.metrics.map((m) => <Badge key={m.id} title={m.id}>{m.label}</Badge>)}</div>
                  ) : <p className="mt-2 text-[11px] text-slate-600">Метрик нет — блок оценивается по ответам анкеты</p>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {editing && (
        <TemplateEditor
          mode={editing.mode}
          draft={editing.draft}
          titleOf={titleOf}
          saving={saving}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onClose={() => !saving && setEditing(null)}
          onSave={() => void save()}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        onConfirm={() => void remove()}
        loading={deleting}
        title={`Удалить шаблон «${toDelete?.title ?? ''}»?`}
        confirmLabel="Удалить"
        text={
          <>
            Компании этого шаблона перейдут на шаблон своей отрасли (или «Универсальный»), и их Точка А пересчитается.
            {toDelete?.usage ? ` Затронуто компаний: ${toDelete.usage.auto + toDelete.usage.explicit}.` : ''}
          </>
        }
      />
    </RequirePermission>
  )
}

function TemplateEditor({ mode, draft, titleOf, saving, onChange, onClose, onSave }: {
  mode: 'create' | 'edit'; draft: Draft; titleOf: (k: string) => string; saving: boolean
  onChange: (d: Draft) => void; onClose: () => void; onSave: () => void
}) {
  const shares = normalised(draft.blocks)
  const keyOk = mode === 'edit' || /^[a-z0-9_-]{2,40}$/.test(draft.key.trim())
  const anyWeighted = draft.blocks.some((b) => b.enabled && b.weight > 0)
  const weightsOk = draft.blocks.every((b) => Number.isFinite(b.weight) && b.weight >= 0 && b.weight <= 1)
  const valid = keyOk && draft.title.trim().length >= 2 && anyWeighted && weightsOk
  const setBlock = (key: BlockKey, patch: Partial<TemplateBlock>) =>
    onChange({ ...draft, blocks: draft.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)) })

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={mode === 'create' ? 'Новый шаблон Точки А' : `Шаблон «${draft.title || draft.key}»`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={onSave}>{mode === 'create' ? 'Создать' : 'Сохранить'}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'create' ? (
          <Field label="Ключ" hint="Латиница в нижнем регистре, цифры, «-» и «_». Потом не меняется.">
            <input value={draft.key} onChange={(e) => onChange({ ...draft, key: e.target.value.toLowerCase() })} className={inputClass} placeholder="horeca" maxLength={40} />
          </Field>
        ) : (
          <Field label="Ключ"><input value={draft.key} disabled className={cx(inputClass, 'opacity-60')} /></Field>
        )}
        <Field label="Название">
          <input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} className={inputClass} placeholder="Общепит и HoReCa" maxLength={80} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Отрасли" hint={draft.key === 'default' ? 'Универсальный шаблон берут компании, чья отрасль не подошла ни к одному другому.' : 'Через запятую: подстроки отрасли компании в нижнем регистре (например «ресторан, кафе, общепит»). До 20.'}>
          <input value={draft.industries} onChange={(e) => onChange({ ...draft, industries: e.target.value })} className={inputClass} placeholder="ресторан, кафе, общепит" />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-1 text-[11px] font-medium text-slate-400">Блоки и веса</p>
        <p className="mb-2 text-[10px] text-slate-600">Вес 0…1. В балл идут доли включённых блоков — справа то, что получится после нормировки.</p>
        <ul className="space-y-1.5">
          {draft.blocks.map((b) => (
            <li key={b.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
              <label className="flex w-36 items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={b.enabled} onChange={(e) => setBlock(b.key, { enabled: e.target.checked })} className="accent-blue-500" />
                {titleOf(b.key)}
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Number.isFinite(b.weight) ? b.weight : ''}
                disabled={!b.enabled}
                onChange={(e) => setBlock(b.key, { weight: e.target.value === '' ? 0 : Number(e.target.value) })}
                aria-label={`Вес блока ${titleOf(b.key)}`}
                className={cx(inputClass, 'w-24 py-1 text-xs')}
              />
              <span className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                <span className="block h-full rounded-full bg-blue-400/70" style={{ width: `${Math.round((shares[b.key] ?? 0) * 100)}%` }} />
              </span>
              <span className="w-12 text-right text-xs tabular-nums text-slate-300">{shares[b.key] ? pct(shares[b.key]) : '—'}</span>
            </li>
          ))}
        </ul>
        {!anyWeighted && <p className="mt-2 text-[11px] text-amber-300">Включите хотя бы один блок с весом больше 0.</p>}
        {!weightsOk && <p className="mt-2 text-[11px] text-amber-300">Вес блока — от 0 до 1.</p>}
        {!keyOk && draft.key && <p className="mt-2 text-[11px] text-amber-300">Неверный ключ.</p>}
      </div>
    </Modal>
  )
}
