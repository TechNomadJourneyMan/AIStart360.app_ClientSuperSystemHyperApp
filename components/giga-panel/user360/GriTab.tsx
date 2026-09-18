'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Star, Trash2 } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, GigaApiError, Panel, Skeleton, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery,
} from '../kit'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { GRI_BLOCK_RU } from '@/lib/gri-assessment/labels'
import { computeGriIndex, computeSectionAvgs } from '@/lib/gri-assessment/score'

interface Assessment {
  id: string; gri_index: number; section_avgs: Record<string, number>; scores: Record<string, Record<string, number>>
  completed_sections: Record<string, boolean>; onboarding: Record<string, unknown>
  top_5_limits: Array<{ sectionId?: string; criterionId?: string; criterionText?: string; text?: string; score?: number }> | null
  is_current: boolean; created_at: string; updated_at: string
}
interface Payload { data: { assessments: Assessment[]; draft: { state: { scores?: Record<string, Record<string, number>> }; updated_at: string } | null } }

const tone = (v: number) => (v >= 7 ? 'text-emerald-300' : v >= 4 ? 'text-amber-300' : v > 0 ? 'text-red-300' : 'text-slate-600')
const bar = (v: number) => (v >= 7 ? 'bg-emerald-400/80' : v >= 4 ? 'bg-amber-400/80' : 'bg-red-400/80')

export function GriTab({ userId, canEdit, canDelete }: { userId: string; canEdit: boolean; canDelete: boolean }) {
  const { data, error, reload } = useGigaQuery<Payload>(`/api/giga-admin/users/${userId}/gri`)
  const list = data?.data.assessments ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = list.find((a) => a.id === selectedId) ?? list.find((a) => a.is_current) ?? list[0] ?? null
  const [editing, setEditing] = useState(false)
  const [draftScores, setDraftScores] = useState<Record<string, Record<string, number>>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'delete' | 'current' | 'draft'>(null)

  useEffect(() => { setEditing(false); setDraftScores({}) }, [selected?.id])

  const preview = useMemo(() => {
    if (!selected) return null
    const merged = JSON.parse(JSON.stringify(selected.scores ?? {})) as Record<string, Record<string, number>>
    for (const [s, c] of Object.entries(draftScores)) {
      merged[s] = { ...(merged[s] ?? {}) }
      for (const [k, v] of Object.entries(c)) { if (v === 0) delete merged[s][k]; else merged[s][k] = v }
    }
    const avgs = computeSectionAvgs(merged)
    return { merged, avgs, index: computeGriIndex(avgs) }
  }, [selected, draftScores])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      setConfirm(null)
      setEditing(false)
      setDraftScores({})
      setReason('')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Операция не выполнена')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Skeleton className="h-96" />
  const draft = data.data.draft
  const changedCount = Object.values(draftScores).reduce((n, c) => n + Object.keys(c).length, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="История прохождений" bodyClassName="p-2">
          {list.length === 0 ? <EmptyState title="GRI не пройден" /> : (
            <ul className="space-y-1">
              {list.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors', selected?.id === a.id ? 'bg-blue-500/15' : 'hover:bg-white/[0.04]')}
                  >
                    <span>
                      <span className="block text-xs text-slate-200">{fmtDateTime(a.created_at)}</span>
                      {a.is_current && <Badge tone="green" className="mt-1">текущий</Badge>}
                    </span>
                    <span className={cx('font-mono text-lg font-bold', tone(a.gri_index))}>{a.gri_index.toFixed(1)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Незавершённый тест">
          {draft ? (
            <div className="space-y-2 text-xs">
              <p className="text-slate-300">Обновлён {fmtDateTime(draft.updated_at)}</p>
              <p className="text-slate-500">Начато блоков: {Object.values(draft.state?.scores ?? {}).filter((c) => Object.keys(c ?? {}).length).length} из {GRI_SECTIONS.length}</p>
              {canEdit && <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setConfirm('draft')}>Сбросить черновик</Button>}
            </div>
          ) : <p className="text-xs text-slate-600">Нет</p>}
        </Panel>
      </div>

      {selected && preview ? (
        <Panel
          title={`Оценка от ${fmtDateTime(selected.created_at)}`}
          description={editing ? `Изменено ответов: ${changedCount}. Индекс после сохранения: ${preview.index.toFixed(2)}` : `Индекс ${selected.gri_index.toFixed(2)} · изменено ${fmtDateTime(selected.updated_at)}`}
          actions={
            <>
              {canEdit && !selected.is_current && !editing && <Button size="sm" icon={<Star size={12} />} onClick={() => setConfirm('current')}>Сделать текущим</Button>}
              {canEdit && !editing && <Button size="sm" variant="primary" onClick={() => setEditing(true)}>Править ответы</Button>}
              {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraftScores({}) }}>Отмена</Button>}
              {editing && <Button size="sm" variant="primary" icon={<Check size={12} />} disabled={!changedCount} onClick={() => act(
                () => gigaFetch(`/api/giga-admin/users/${userId}/gri/${selected.id}`, { method: 'PATCH', json: { scores: draftScores, reason: reason || 'Правка администратора' } }),
                'Ответы сохранены, индекс и план пересчитаны',
              )} loading={busy}>Сохранить</Button>}
              {canDelete && !editing && <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setConfirm('delete')}>Удалить</Button>}
            </>
          }
        >
          {editing && (
            <div className="mb-4">
              <Field label="Причина правки"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
            </div>
          )}
          <div className="space-y-4">
            {GRI_SECTIONS.map((sec) => {
              const avg = Number((editing ? preview.avgs : selected.section_avgs)?.[sec.id] ?? 0)
              return (
                <details key={sec.id} className="group rounded-xl border border-white/[0.06] bg-white/[0.02]" open={editing}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">{GRI_BLOCK_RU[sec.id]}</span>
                    <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-white/[0.06] sm:block">
                      <div className={cx('h-full', bar(avg))} style={{ width: `${avg * 10}%` }} />
                    </div>
                    <span className={cx('w-10 text-right font-mono text-xs font-bold', tone(avg))}>{avg ? avg.toFixed(1) : '—'}</span>
                  </summary>
                  <ul className="divide-y divide-white/[0.04] border-t border-white/[0.05] px-3">
                    {sec.criteria.map((c) => {
                      const original = selected.scores?.[sec.id]?.[c.id] ?? 0
                      const current = preview.merged[sec.id]?.[c.id] ?? 0
                      return (
                        <li key={c.id} className="flex items-center gap-3 py-2">
                          <span className="min-w-0 flex-1 text-[11px] text-slate-400">{c.text}</span>
                          {editing ? (
                            <select
                              aria-label={c.text}
                              value={current}
                              onChange={(e) => {
                                const v = Number(e.target.value)
                                setDraftScores((prev) => {
                                  const next = { ...prev, [sec.id]: { ...(prev[sec.id] ?? {}) } }
                                  if (v === original) delete next[sec.id][c.id]
                                  else next[sec.id][c.id] = v
                                  return next
                                })
                              }}
                              className={cx('rounded-lg border bg-[#0b1128] px-2 py-1 text-xs', current !== original ? 'border-amber-400/50 text-amber-200' : 'border-white/[0.1] text-slate-200')}
                            >
                              <option value={0}>—</option>
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          ) : (
                            <span className={cx('w-6 text-right font-mono text-xs font-semibold', tone(original))}>{original || '—'}</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )
            })}
          </div>
          {!editing && Array.isArray(selected.top_5_limits) && selected.top_5_limits.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">ТОП-5 ограничений</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
                {selected.top_5_limits.map((l, i) => <li key={i}>{l.criterionText ?? l.text ?? l.criterionId ?? '—'}{typeof l.score === 'number' ? <span className="ml-1 text-slate-500">({l.score})</span> : null}</li>)}
              </ol>
            </div>
          )}
        </Panel>
      ) : (
        <Panel><EmptyState title="Нет результатов GRI" text="Пользователь ещё не завершил диагностику." /></Panel>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Удалить результат GRI?"
        text="Результат будет удалён из кабинета пользователя. Полная копия сохранится в журнале аудита."
        confirmLabel="Удалить результат"
        requireText="УДАЛИТЬ"
        loading={busy}
        onConfirm={() => selected && act(() => gigaFetch(`/api/giga-admin/users/${userId}/gri/${selected.id}`, { method: 'DELETE', json: { reason } }), 'Результат удалён')}
      >
        <Field label="Причина (обязательно)"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'current'}
        onClose={() => setConfirm(null)}
        tone="primary"
        title="Сделать этот результат текущим?"
        text="Пользователь увидит этот результат в кабинете и в GRI."
        confirmLabel="Сделать текущим"
        loading={busy}
        onConfirm={() => selected && act(() => gigaFetch(`/api/giga-admin/users/${userId}/gri/${selected.id}`, { method: 'PATCH', json: { makeCurrent: true, reason: reason || 'Выбор текущего результата' } }), 'Текущий результат изменён')}
      >
        <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'draft'}
        onClose={() => setConfirm(null)}
        title="Сбросить незавершённый тест?"
        text="Пользователь начнёт GRI заново на других устройствах. Копия черновика сохранится в журнале."
        confirmLabel="Сбросить"
        loading={busy}
        onConfirm={() => act(() => gigaFetch(`/api/giga-admin/users/${userId}/gri/draft`, { method: 'DELETE', json: { reason } }), 'Черновик сброшен')}
      >
        <Field label="Причина (обязательно)"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
    </div>
  )
}
