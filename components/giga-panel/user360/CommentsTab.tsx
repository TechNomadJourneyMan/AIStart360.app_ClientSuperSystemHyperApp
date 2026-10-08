'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Send, Trash2 } from 'lucide-react'
import { GROUP_LABEL, GROUP_ORDER, groupOf, targetLabel, targetsByGroup, type TargetGroup } from '@/lib/comment-targets'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, GigaApiError, Panel, Skeleton, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'
import { useStaff } from '../StaffContext'

/**
 * Комментарии экспертов клиенту: лента по блокам кабинета + форма нового
 * комментария. Комментарий ПУБЛИЧНЫЙ — клиент увидит его и получит
 * уведомление (внутренние заметки — вкладка «Заметки»).
 */

interface Comment {
  id: string; authorId: string; authorName: string | null; authorTitle: string | null
  targetId: string | null; text: string; createdAt: string; updatedAt: string
}

/** Что уходит на сервер. Отдельной функцией — сюда легко добавить `status` (черновик / опубликован). */
export interface CommentDraft { text: string; targetId: string | null }
export function buildCommentPayload(d: CommentDraft): Record<string, unknown> {
  return { text: d.text.trim(), targetId: d.targetId || null }
}

const COMPOSER_GROUPS: TargetGroup[] = ['point-a', 'gri', 'pulse', 'dashboard']

export function CommentsTab({ userId, canReview }: { userId: string; canReview: boolean }) {
  const { me, can } = useStaff()
  const { data, error, loading, reload } = useGigaQuery<{ data: Comment[] }>(`/api/giga-admin/users/${userId}/comments`)
  const [draft, setDraft] = useState<CommentDraft>({ text: '', targetId: null })
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState<Comment | null>(null)

  const grouped = useMemo(() => {
    const out = new Map<TargetGroup, Comment[]>()
    for (const c of data?.data ?? []) {
      const g = groupOf(c.targetId)
      out.set(g, [...(out.get(g) ?? []), c])
    }
    return GROUP_ORDER.filter((g) => out.has(g)).map((g) => ({ group: g, items: out.get(g)! }))
  }, [data])

  const send = async () => {
    if (!draft.text.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/comments`, { method: 'POST', json: buildCommentPayload(draft) })
      setDraft((d) => ({ ...d, text: '' }))
      toast.success('Комментарий отправлен клиенту')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/comments/${toDelete.id}`, { method: 'DELETE' })
      toast.success('Комментарий удалён')
      setToDelete(null)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    }
  }

  return (
    <div className="space-y-4">
      {canReview && (
        <Panel title="Новый комментарий клиенту" description="Клиент увидит комментарий в кабинете рядом с выбранным блоком и получит уведомление.">
          <div className="space-y-2">
            <select
              value={draft.targetId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, targetId: e.target.value || null }))}
              aria-label="К какому блоку"
              className="w-full rounded-xl border border-white/[0.08] bg-[#0b1128] px-3 py-2 text-xs text-slate-200 focus:border-blue-500/40 focus:outline-none"
            >
              <option value="">Общее (без привязки к блоку)</option>
              {COMPOSER_GROUPS.map((g) => (
                <optgroup key={g} label={GROUP_LABEL[g]}>
                  {targetsByGroup(g).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </optgroup>
              ))}
            </select>
            <textarea
              value={draft.text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              rows={4}
              maxLength={5000}
              placeholder="Что вы видите в данных клиента и что советуете сделать"
              className={inputClass}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600">{draft.text.length}/5000</span>
              <Button variant="primary" icon={<Send size={13} />} loading={busy} disabled={!draft.text.trim()} onClick={() => void send()}>
                Отправить клиенту
              </Button>
            </div>
          </div>
        </Panel>
      )}

      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Skeleton className="h-32" />}
      {data && !data.data.length && (
        <Panel><EmptyState title="Комментариев пока нет" text={canReview ? 'Первый комментарий клиент увидит у себя в кабинете.' : 'Эксперты ещё не оставляли комментариев этому клиенту.'} /></Panel>
      )}

      {grouped.map(({ group, items }) => (
        <Panel key={group} title={GROUP_LABEL[group]} actions={<Badge>{items.length}</Badge>}>
          <ul className="space-y-3">
            {items.map((c) => (
              <li key={c.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {c.targetId && <Badge tone="blue" className="mb-1.5">{targetLabel(c.targetId)}</Badge>}
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{c.text}</p>
                  </div>
                  {canReview && (c.authorId === me?.id || can('users.manage')) && (
                    <button onClick={() => setToDelete(c)} title="Удалить" aria-label="Удалить комментарий" className="rounded-lg p-1.5 text-slate-600 transition-colors hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-600">
                  {c.authorName ?? 'Эксперт'}{c.authorTitle ? ` · ${c.authorTitle}` : ''} · {fmtDateTime(c.createdAt)}
                  {c.updatedAt !== c.createdAt && ' · изменён'}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Удалить комментарий?"
        text="Клиент перестанет его видеть. Текст останется в журнале действий."
        confirmLabel="Удалить"
      />
    </div>
  )
}
