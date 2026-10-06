'use client'

/**
 * «Проверка выводов ИИ» — model output waiting for a person before a client
 * may see it: hypotheses of the `diagnostic` agent (AI_HYPOTHESIS) and
 * proposals of the `recommendation` agent's model step. Each card shows the
 * claim, its confidence, the model and prompt version, and the evidence it
 * cites. Approve → visible to the client at once (Точка А reads it through
 * RLS) and in the next published report version;
 * dismiss → hidden for good, with a reason (insights.moderate, audited).
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, RefreshCw, ScanSearch, X } from 'lucide-react'
import { RequirePermission } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, EmptyState, ErrorState, Field, Modal, PageHeader, Skeleton, Tabs, fmtAgo, fmtDateTime, gigaFetch, inputClass,
  useGigaQuery,
} from '../kit'
import { CompanyPicker, type PickedCompany } from '../agents/CompanyPicker'
import { Mono, StatusChip } from '../agents/ui'
import type { ReviewItem } from '@/lib/reports/review'
import { AI_REVIEW_COPY, EVIDENCE_TYPE_LABELS, fmtConfidence, provenanceMeta, severityMeta } from './model'

interface QueueResponse { items: ReviewItem[]; can: { run: boolean } }
type Tab = 'finding' | 'recommendation'

export function AiReviewPage() {
  const { base } = useWorkspace()
  const [tab, setTab] = useState<Tab>('finding')
  const [company, setCompany] = useState<PickedCompany | null>(null)
  const q = useGigaQuery<QueueResponse>(`/api/giga-admin/ai-review${company ? `?company=${encodeURIComponent(company.id)}` : ''}`)
  const [deciding, setDeciding] = useState<{ item: ReviewItem; decision: 'approve' | 'dismiss' } | null>(null)

  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const shown = items.filter((i) => i.kind === tab)
  const counts = { finding: items.filter((i) => i.kind === 'finding').length, recommendation: items.filter((i) => i.kind === 'recommendation').length }

  const onDone = (item: ReviewItem, decision: 'approve' | 'dismiss') => {
    q.setData((d) => (d ? { ...d, items: d.items.filter((i) => !(i.kind === item.kind && i.id === item.id)) } : d))
    toast.success(decision === 'approve' ? AI_REVIEW_COPY.approveToast : AI_REVIEW_COPY.dismissToast)
  }

  return (
    <RequirePermission permission="insights.moderate">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ и автоматизация' }, { label: 'Проверка выводов ИИ' }]}
        title="Проверка выводов ИИ"
        description={AI_REVIEW_COPY.header}
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'finding', label: 'Гипотезы ИИ', count: q.data ? counts.finding : null },
            { key: 'recommendation', label: 'Рекомендации модели', count: q.data ? counts.recommendation : null },
          ]}
        />
        <div className="w-full max-w-sm"><CompanyPicker value={company} onChange={setCompany} compact /></div>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        После решений соберите отчёт заново в разделе <Link href={`${base}/reports`} className="text-blue-300 hover:underline">«Отчёты»</Link> — опубликованная клиенту версия отчёта сама не меняется (а «Точка А» показывает одобренное сразу).
      </p>
      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}

      {!q.data && q.loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : q.data && shown.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <EmptyState
            icon={<ScanSearch size={18} />}
            title={tab === 'finding' ? 'Гипотез на проверке нет' : 'Предложений модели на проверке нет'}
            text="Когда агенты диагностики построят новые выводы моделью, они появятся здесь."
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <ReviewCard key={`${item.kind}:${item.id}`} item={item} onDecide={(decision) => setDeciding({ item, decision })} />
          ))}
        </ul>
      )}

      <DecisionModal state={deciding} onClose={() => setDeciding(null)} onDone={(item, d) => { setDeciding(null); onDone(item, d) }} onStale={() => void q.reload()} />
    </RequirePermission>
  )
}

function ReviewCard({ item, onDecide }: { item: ReviewItem; onDecide: (d: 'approve' | 'dismiss') => void }) {
  return (
    <li className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip meta={item.kind === 'finding' ? provenanceMeta('AI_HYPOTHESIS') : { label: 'Рекомендация модели', tone: 'violet' }} />
            {item.severity && <StatusChip meta={severityMeta(item.severity)} />}
            {item.priority !== null && <Badge tone={item.priority <= 2 ? 'red' : 'neutral'}>приоритет {item.priority}</Badge>}
            {item.horizon_days !== null && <Badge>{item.horizon_days} дн.</Badge>}
            <Badge>{item.area_label}</Badge>
            <Badge tone="blue" title="Уверенность модели (не выше 70% для гипотез)">уверенность {fmtConfidence(item.confidence)}</Badge>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-100">{item.title}</p>
          {item.body && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-400">{item.body}</p>}
          {item.expected_impact && <p className="mt-1 text-xs text-emerald-300">Ожидаемый эффект: {item.expected_impact}</p>}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>{item.company_name || item.company_id}</span>
            <span title={fmtDateTime(item.created_at)}>{fmtAgo(item.created_at)}</span>
            {item.model && <span>модель <Mono>{item.model}</Mono></span>}
            {item.prompt_version && <span>промпт <Mono>{item.prompt_version}</Mono></span>}
          </p>

          <div className="mt-3 rounded-xl border border-white/[0.05] bg-black/20 p-3">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">
              {item.kind === 'finding' ? `Доказательства (${item.evidence.length})` : `Закрывает выводы (${item.evidence.length})`}
            </p>
            {item.evidence.length === 0 ? <p className="text-[11px] text-amber-300">Ссылок на данные нет — такую рекомендацию лучше отклонить.</p> : (
              <ul className="space-y-1">
                {item.evidence.map((e, i) => (
                  <li key={i} className="text-[11px] text-slate-400">
                    <span className="text-slate-500">{EVIDENCE_TYPE_LABELS[e.type] ?? e.type}:</span>{' '}
                    {e.label ? <span className="text-slate-200">{e.label}</span> : <Mono className="text-slate-300">{e.ref}</Mono>}
                    {e.field && <span className="text-slate-500"> · {e.field}</span>}
                    {e.value !== null && <span className="text-slate-200"> = {typeof e.value === 'number' ? e.value.toLocaleString('ru-RU') : e.value}</span>}
                    {e.quote && <span className="block text-slate-500">«{e.quote}»</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="danger" icon={<X size={12} />} onClick={() => onDecide('dismiss')} aria-label={`Отклонить: ${item.title}`}>Отклонить</Button>
          <Button size="sm" variant="primary" icon={<Check size={12} />} onClick={() => onDecide('approve')} aria-label={`Показать клиенту: ${item.title}`}>Показать клиенту</Button>
        </div>
      </div>
    </li>
  )
}

function DecisionModal({ state, onClose, onDone, onStale }: {
  state: { item: ReviewItem; decision: 'approve' | 'dismiss' } | null
  onClose: () => void
  onDone: (item: ReviewItem, decision: 'approve' | 'dismiss') => void
  onStale: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setReason(''); setError(null) }, [state])
  const approve = state?.decision === 'approve'
  const tooShort = !approve && reason.trim().length < 3

  const submit = async () => {
    if (!state || tooShort) return
    setBusy(true)
    setError(null)
    try {
      await gigaFetch(`/api/giga-admin/ai-review/${state.item.kind}/${state.item.id}`, {
        method: 'POST',
        json: { decision: state.decision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      })
      onDone(state.item, state.decision)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение')
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) onStale()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!state}
      onClose={busy ? () => {} : onClose}
      title={approve ? 'Показать клиенту?' : 'Отклонить вывод модели?'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={busy} disabled={tooShort} onClick={() => void submit()} icon={approve ? <Check size={13} /> : <X size={13} />}>
            {approve ? 'Показать клиенту' : 'Отклонить'}
          </Button>
        </>
      }
    >
      {state && (
        <div className="space-y-3 text-xs">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <p className="font-medium text-slate-100">{state.item.title}</p>
            <p className="mt-1 text-[11px] text-slate-500">{state.item.company_name || state.item.company_id} · уверенность {fmtConfidence(state.item.confidence)}</p>
          </div>
          <p className="leading-relaxed text-slate-400">
            {approve ? AI_REVIEW_COPY.approveDialog(state.item.kind) : AI_REVIEW_COPY.dismissDialog}
          </p>
          <Field label={approve ? 'Комментарий (необязательно)' : 'Причина (обязательно)'} hint={`${reason.length}/500`}>
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder={approve ? 'Например: проверил по выгрузке CRM' : 'Например: вывод противоречит данным документа'} />
          </Field>
          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
