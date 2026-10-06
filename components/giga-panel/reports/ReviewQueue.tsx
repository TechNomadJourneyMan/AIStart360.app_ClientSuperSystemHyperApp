'use client'

/**
 * «Отчёты на проверке» — report versions waiting for the expert (status
 * 'in_review', migration 103) in GIGA → Отчёты and the SuperExpert cabinet.
 *
 * Data: GET /api/giga-admin/reports/review (reports.review). A version opens
 * its PDF (GET /api/giga-admin/reports/:id/pdf — «Версия N · дата», watermark
 * «На проверке эксперта»); decisions go to POST /api/giga-admin/reports/:id/review:
 *   «Подтвердить и опубликовать» — published to the client at once;
 *   «Нужны правки» — comment required, the report agent rebuilds (capped).
 * The same server function decides for the expert cabinet and the expert bot.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, FileClock, PencilLine, RefreshCw } from 'lucide-react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Panel, fmtAgo, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'
import { shortActor } from '../agents/model'
import type { ReviewRow, ReviewVersionHead } from '@/lib/reports/review-flow'
import { versionStamp } from '@/lib/reports/version-stamp'
import { REPORT_TYPE_LABELS, REVIEW_CHANNEL_LABELS, REVIEW_DECISION_LABELS, rerunLabel } from './model'

interface QueueResponse { items: ReviewVersionHead[]; decisions: ReviewRow[] }
interface DecideResponse { decision: string; already: boolean; rerun: { state: string; attempt: number; max: number } | null }

export function ReviewQueue({ onDecided }: { onDecided?: () => void }) {
  const q = useGigaQuery<QueueResponse>('/api/giga-admin/reports/review')
  const [target, setTarget] = useState<{ item: ReviewVersionHead; decision: 'approve' | 'changes_requested' } | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const r = await gigaFetch<DecideResponse>(`/api/giga-admin/reports/${target.item.id}/review`, {
        method: 'POST',
        json: target.decision === 'approve' ? { decision: 'approve' } : { decision: 'changes_requested', comment: comment.trim() },
      })
      toast.success(target.decision === 'approve'
        ? (r.already ? 'Уже опубликовано ранее' : `Опубликовано клиенту: ${versionStamp(target.item.version, target.item.created_at)}`)
        : `Правки отправлены${rerunLabel(r.rerun) ? `: ${rerunLabel(r.rerun)}` : ''}`)
      setTarget(null)
      setComment('')
      await q.reload()
      onDecided?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение')
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) void q.reload()
    } finally {
      setBusy(false)
    }
  }

  const items = q.data?.items ?? []
  return (
    <Panel
      title={<span className="inline-flex items-center gap-2">Отчёты на проверке {items.length > 0 && <Badge tone="amber">{items.length}</Badge>}</span>}
      description="Версии, которые агент «Отчёт» собрал после диагностики. Клиент не видит их, пока эксперт не подтвердит; «Подтвердить» сразу публикует."
      actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      className="mb-4"
    >
      {q.error && <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      {!q.error && q.data && items.length === 0 && (
        <EmptyState icon={<FileClock size={18} />} title="Нет отчётов на проверке" text="Новая версия появится здесь, в боте экспертов и в кабинете эксперта." />
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-white/[0.05]">
          {items.map((v) => (
            <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{v.company_name || v.company_id}</p>
                <p className="text-[11px] text-slate-500">
                  {REPORT_TYPE_LABELS[v.report_type] ?? v.report_type} · <span className="font-mono">{versionStamp(v.version, v.created_at)}</span> · <span title={fmtDateTime(v.created_at)}>{fmtAgo(v.created_at)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/api/giga-admin/reports/${v.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-blue-300 hover:bg-white/[0.04]">
                  <ExternalLink size={12} /> PDF
                </a>
                <Button size="sm" variant="primary" icon={<Check size={12} />} onClick={() => { setError(null); setTarget({ item: v, decision: 'approve' }) }}>Подтвердить и опубликовать</Button>
                <Button size="sm" variant="ghost" icon={<PencilLine size={12} />} onClick={() => { setError(null); setComment(''); setTarget({ item: v, decision: 'changes_requested' }) }}>Нужны правки</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(q.data?.decisions.length ?? 0) > 0 && (
        <details className="mt-3 text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Последние решения</summary>
          <ul className="mt-2 space-y-1">
            {q.data!.decisions.slice(0, 10).map((d) => (
              <li key={d.id}>
                {fmtDateTime(d.created_at)} · {REVIEW_DECISION_LABELS[d.decision] ?? d.decision} · {shortActor(d.reviewer_id)} ({REVIEW_CHANNEL_LABELS[d.channel] ?? d.channel})
                {d.comment ? ` — «${d.comment}»` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={!!target}
        onClose={() => { if (!busy) { setTarget(null); setError(null) } }}
        onConfirm={() => void submit()}
        loading={busy}
        tone={target?.decision === 'approve' ? 'primary' : 'warning'}
        title={target?.decision === 'approve'
          ? `Опубликовать клиенту: ${target ? versionStamp(target.item.version, target.item.created_at) : ''}?`
          : 'Вернуть отчёт на доработку?'}
        confirmLabel={target?.decision === 'approve' ? 'Подтвердить и опубликовать' : 'Отправить правки'}
        text={target?.decision === 'approve'
          ? 'Клиент сразу увидит эту версию и получит уведомление; ранее опубликованная версия будет заменена. Решение пишется в журнал аудита.'
          : 'Комментарий сохранится, агент «Отчёт» пересоберёт отчёт (ограниченное число раз на одну диагностику). Клиент эту версию не увидит.'}
      >
        {target?.decision === 'changes_requested' && (
          <Field label="Что поправить (обязательно)" hint={`${comment.length}/2000`}>
            <textarea value={comment} maxLength={2000} rows={3} onChange={(e) => setComment(e.target.value)} className={inputClass} placeholder="Например: вывод по продажам опирается на устаревшую выручку" />
          </Field>
        )}
        {target?.decision === 'changes_requested' && comment.trim().length < 3 && <p className="mt-1 text-[11px] text-slate-500">Без комментария (от 3 символов) правки не отправятся.</p>}
        {error && <p role="alert" className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
      </ConfirmDialog>
    </Panel>
  )
}
