'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Send, Sparkles } from 'lucide-react'
import { Button, ConfirmDialog, ErrorState, Field, GigaApiError, Panel, Skeleton, StatTile, gigaFetch, inputClass, useGigaQuery } from '../../kit'
import { useStaff } from '../../StaffContext'
import { REVIEW_BLOCKS, fromStoredBlockKey } from '@/lib/expert-review/blocks'
import { pluralComments } from '@/lib/email/templates'
import { BlockSection } from './BlockSection'
import { PointBReview } from './PointBReview'
import { PublishedHistory } from './PublishedHistory'
import type { DraftComment, ReviewPayload } from './types'

/**
 * Вкладка «Разбор» в User 360 (F-030 / F-031 / F-074).
 *
 * Эксперт копит черновик разбора по блокам (7 блоков GRI, Точка А, Точка Б,
 * «Общее»), вставляет шаблоны, может попросить ИИ набросать черновик — и
 * публикует всё ОДНИМ действием: клиент получает одно письмо и одно
 * уведомление. До публикации клиент ничего не видит.
 */
export function ReviewTab({ userId }: { userId: string }) {
  const { can } = useStaff()
  const allowed = can('clients.review')
  const { data, error, loading, reload } = useGigaQuery<{ data: ReviewPayload; unavailable?: boolean }>(
    allowed ? `/api/giga-admin/users/${userId}/review` : null,
  )
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [toDelete, setToDelete] = useState<DraftComment | null>(null)

  const payload = data?.data
  const comments = useMemo(() => payload?.comments ?? [], [payload])
  const draft = payload?.draft ?? null

  useEffect(() => {
    setTitle(draft?.title ?? '')
    setSummary(draft?.summary ?? '')
  }, [draft?.id, draft?.title, draft?.summary])

  const byBlock = useMemo(() => {
    const m = new Map<string, DraftComment[]>()
    for (const c of comments) {
      const k = fromStoredBlockKey(c.block_key)
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [comments])
  const known = new Set<string>(REVIEW_BLOCKS.map((b) => b.key))
  const legacy = comments.filter((c) => !known.has(fromStoredBlockKey(c.block_key)))
  const aiCount = comments.filter((c) => c.source === 'ai').length
  const blocked = comments.filter((c) => (c.ai_flags ?? []).some((f) => f.severity === 'error')).length
  const metaDirty = (title.trim() || null) !== (draft?.title ?? null) || (summary.trim() || null) !== (draft?.summary ?? null)

  if (!allowed) {
    return <p className="text-xs text-slate-500">Разбор клиента доступен SuperExpert, Admin и Super Admin.</p>
  }

  const saveMeta = async () => {
    setSavingMeta(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review`, { method: 'POST', json: { title: title.trim() || null, summary: summary.trim() || null } })
      toast.success('Черновик сохранён')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSavingMeta(false)
    }
  }

  const aiDraft = async () => {
    setAiBusy(true)
    try {
      const r = await gigaFetch<{ data: { created: number; dropped: unknown[]; missing: string[] } }>(
        `/api/giga-admin/users/${userId}/review/ai-draft`,
        { method: 'POST' },
      )
      const { created, dropped, missing } = r.data
      toast.success(`ИИ добавил в черновик ${pluralComments(created)}. Проверьте каждый перед публикацией.`)
      if (missing.length) toast.info(`Не хватает данных: ${missing.join('; ')}`)
      if (dropped.length) toast.warning(`Проверка отклонила текстов: ${dropped.length}`)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'ИИ-черновик не получился')
    } finally {
      setAiBusy(false)
    }
  }

  const publish = async () => {
    setPublishing(true)
    try {
      if (metaDirty) {
        await gigaFetch(`/api/giga-admin/users/${userId}/review`, { method: 'POST', json: { title: title.trim() || null, summary: summary.trim() || null } })
      }
      const r = await gigaFetch<{ data: { published: number; email: { sent: boolean; error: string | null } } }>(
        `/api/giga-admin/users/${userId}/review/publish`,
        { method: 'POST', json: { expectedCount: comments.length } },
      )
      toast.success(`Разбор опубликован: ${pluralComments(r.data.published)}`)
      if (!r.data.email.sent) toast.warning('Письмо клиенту не ушло — уведомление в кабинете создано.')
      setConfirmPublish(false)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось опубликовать')
      if (e instanceof GigaApiError && e.status === 409) reload()
    } finally {
      setPublishing(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review/comments/${toDelete.id}`, { method: 'DELETE' })
      toast.success('Комментарий удалён из черновика')
      setToDelete(null)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    }
  }

  return (
    <div className="space-y-4">
      <ErrorState error={error} onRetry={reload} />
      {data?.unavailable && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Хранилище разборов недоступно — вероятно, не применена миграция 087.
        </p>
      )}
      {loading && !data && <Skeleton className="h-40" />}

      {payload && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="В черновике" value={comments.length} hint="клиент пока не видит" tone="blue" />
            <StatTile label="От ИИ" value={aiCount} hint={blocked ? `с ошибками: ${blocked}` : 'проверьте перед публикацией'} tone="violet" />
            <StatTile label="Блоков затронуто" value={byBlock.size} hint={`из ${REVIEW_BLOCKS.length}`} tone="neutral" />
            <StatTile label="Опубликовано разборов" value={payload.published.length} tone="green" />
          </div>

          <Panel
            title="Черновик разбора"
            description="Всё, что здесь, клиент увидит только после публикации — одним письмом и одним уведомлением."
            actions={
              <>
                <Button icon={<Sparkles size={13} />} loading={aiBusy} onClick={() => void aiDraft()}>Сгенерировать черновик ИИ</Button>
                <Button variant="primary" icon={<Send size={13} />} disabled={!comments.length || blocked > 0} onClick={() => setConfirmPublish(true)}>
                  Опубликовать разбор
                </Button>
              </>
            }
          >
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Заголовок (необязательно)">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Например: Разбор по итогам GRI, сентябрь" className={inputClass} />
              </Field>
              <Field label="Вступление (необязательно)">
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={5000} placeholder="Главный вывод в двух-трёх предложениях" className={inputClass} />
              </Field>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600">
                {blocked > 0 ? `Поправьте ИИ-комментарии с ошибками проверки (${blocked}) — до этого публикация закрыта.` : 'ИИ-черновики никогда не публикуются сами.'}
              </span>
              <Button size="sm" loading={savingMeta} disabled={!metaDirty} onClick={() => void saveMeta()}>Сохранить</Button>
            </div>
          </Panel>

          {REVIEW_BLOCKS.map((b) => (
            <BlockSection
              key={b.key}
              userId={userId}
              block={b.key}
              label={b.label}
              comments={byBlock.get(b.key) ?? []}
              onChanged={reload}
              onDelete={setToDelete}
            />
          ))}

          {legacy.length > 0 && (
            <BlockSection userId={userId} block="general" label="Прочие (старые блоки)" comments={legacy} onChanged={reload} onDelete={setToDelete} />
          )}

          <PointBReview userId={userId} />

          <PublishedHistory reviews={payload.published} />
        </>
      )}

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => void publish()}
        loading={publishing}
        tone="primary"
        title="Опубликовать разбор?"
        confirmLabel="Опубликовать"
        text={
          <>
            Клиент увидит {pluralComments(comments.length)} в {byBlock.size} блок(ах) и получит <b>одно</b> письмо
            «Эксперт подготовил разбор» и одно уведомление в кабинете.
            {aiCount > 0 && <> Среди них {aiCount} от ИИ — убедитесь, что вы их прочитали.</>}
            {' '}Опубликованные комментарии больше нельзя править.
          </>
        }
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        title="Удалить комментарий из черновика?"
        text="Клиент его не видел. Факт удаления останется в журнале."
        confirmLabel="Удалить"
      />
    </div>
  )
}
