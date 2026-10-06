'use client'

/**
 * «Отчёты» — versions of client reports built by the `report` agent.
 *
 * List: company, type and version, status, short data hash, who generated it,
 * confidence (data completeness), what went in and what was held back for
 * review. A version opens in a drawer with its frozen snapshot (provenance
 * badges, evidence, sources) and the actions a person decides on:
 *   publish (ready → published, reports.publish), reject (with a reason),
 *   withdraw a published one (with a reason), PDF preview, and «Собрать
 *   заново» (agents.run) after reviewing model output.
 * Nothing reaches the client without «Опубликовать».
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, Check, ExternalLink, FileBarChart, RefreshCw, RotateCcw, Undo2 } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, PageHeader, Panel, Skeleton, cx,
  fmtAgo, fmtDateTime, gigaFetch, inputClass, useGigaQuery, type Column,
} from '../kit'
import { CompanyPicker, type PickedCompany } from '../agents/CompanyPicker'
import { shortActor } from '../agents/model'
import { ChipFilter, KV, Mono, NoRightHint, StatusChip } from '../agents/ui'
import type { ReportVersionFull, ReportVersionListItem } from '@/lib/reports/versions'
import {
  NARRATIVE_STATE_LABELS, REPORT_TYPE_LABELS, createdByLabel, fmtConfidence, reportStatusMeta, shortHash, versionActions,
} from './model'
import { ReportSnapshotView } from './ReportSnapshotView'

interface ListResponse { items: ReportVersionListItem[]; can: { publish: boolean; run: boolean } }
interface ItemResponse { item: ReportVersionFull; can: { publish: boolean; run: boolean } }
type Action = 'publish' | 'reject' | 'withdraw'

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'ready', label: 'Готовы к проверке' },
  { value: 'published', label: 'Опубликованы' },
  { value: 'superseded', label: 'Заменены' },
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

const NO_PUBLISH = 'Публиковать, отклонять и отзывать отчёты может роль с правом «Отчёты: публикация клиенту»'

export function ReportsPage() {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const sp = useSearchParams()
  const [status, setStatus] = useState<StatusFilter>(sp.get('status') === 'ready' ? 'ready' : '')
  const [company, setCompany] = useState<PickedCompany | null>(null)
  const [openId, setOpenId] = useState<string | null>(sp.get('focus'))

  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (company) p.set('company', company.id)
    return `/api/giga-admin/reports${p.toString() ? `?${p}` : ''}`
  }, [status, company])
  const q = useGigaQuery<ListResponse>(url)

  const columns: Column<ReportVersionListItem>[] = [
    { key: 'company', header: 'Компания', render: (r) => <span className="block max-w-[200px] truncate text-slate-200" title={r.company_id}>{r.company_name || r.company_id}</span> },
    { key: 'version', header: 'Отчёт', render: (r) => <span className="whitespace-nowrap">{REPORT_TYPE_LABELS[r.report_type] ?? r.report_type} · <span className="font-mono">v{r.version}</span></span> },
    { key: 'status', header: 'Статус', render: (r) => <StatusChip meta={reportStatusMeta(r.status)} /> },
    { key: 'hash', header: 'Хеш данных', render: (r) => <Mono className="text-slate-300">{shortHash(r.data_hash)}</Mono> },
    { key: 'by', header: 'Сформировал', render: (r) => <span className="whitespace-nowrap">{createdByLabel(r.created_by)}{r.has_narrative && <Badge tone="violet" className="ml-1">+ резюме ИИ</Badge>}</span> },
    { key: 'conf', header: 'Уверенность', render: (r) => <span title="Полнота данных, на которых построен отчёт" className="font-mono">{fmtConfidence(r.confidence)}</span> },
    {
      key: 'content',
      header: 'Содержимое',
      render: (r) => (
        <span className="whitespace-nowrap text-slate-400">
          выводов {r.findings} · рек. {r.recommendations}
          {(r.hidden_hypotheses ?? 0) + (r.unreviewed_model_recommendations ?? 0) > 0 && (
            <Badge tone="amber" className="ml-1" title="Выводы модели, которые не вошли в отчёт до проверки сотрудником">
              на проверке {(r.hidden_hypotheses ?? 0) + (r.unreviewed_model_recommendations ?? 0)}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'created', header: 'Создан', render: (r) => <span className="whitespace-nowrap" title={fmtDateTime(r.created_at)}>{fmtAgo(r.created_at)}</span> },
    { key: 'published', header: 'Опубликован', render: (r) => (r.published_at ? <span className="whitespace-nowrap" title={`${fmtDateTime(r.published_at)} · ${shortActor(r.published_by)}`}>{fmtAgo(r.published_at)}</span> : <span className="text-slate-600">—</span>) },
  ]

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ и автоматизация' }, { label: 'Отчёты' }]}
        title="Отчёты"
        description="Версии отчётов собирает агент «Отчёт» после диагностики — снимок данных с происхождением каждого вывода. Клиент видит версию только после публикации сотрудником; гипотезы ИИ попадают в отчёт только после проверки."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <ChipFilter label="Статус" value={status} options={STATUS_FILTERS} onChange={setStatus} />
        <div className="w-full max-w-sm"><CompanyPicker value={company} onChange={setCompany} compact /></div>
      </div>
      {q.data && !q.data.can.publish && <div className="mb-3"><NoRightHint>{NO_PUBLISH}.</NoRightHint></div>}
      {can('insights.moderate') && (
        <p className="mb-3 text-[11px] text-slate-500">
          Гипотезы ИИ и предложения модели проверяются в разделе <Link href={`${base}/ai-review`} className="text-blue-300 hover:underline">«Проверка выводов ИИ»</Link>; после проверки соберите отчёт заново.
        </p>
      )}
      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}

      <Panel title="Версии отчётов" bodyClassName="p-0" description="До 100 последних версий, новые сверху.">
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          loading={q.loading && !q.data}
          onRowClick={(r) => setOpenId(r.id)}
          empty={<EmptyState icon={<FileBarChart size={18} />} title="Версий отчётов пока нет" text="Агент «Отчёт» собирает версию после завершения диагностики компании или по ручному запуску." />}
        />
      </Panel>

      <VersionDrawer id={openId} base={base} onClose={() => setOpenId(null)} onChanged={() => void q.reload()} />
    </RequirePermission>
  )
}

function VersionDrawer({ id, base, onClose, onChanged }: { id: string | null; base: string; onClose: () => void; onChanged: () => void }) {
  const router = useRouter()
  const q = useGigaQuery<ItemResponse>(id ? `/api/giga-admin/reports/${id}` : null)
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  useEffect(() => { setAction(null); setReason(''); setError(null) }, [id])

  const item = q.data?.item
  const can = q.data?.can ?? { publish: false, run: false }
  const actions = item ? versionActions(item.status, can.publish) : []
  const needsReason = action === 'reject' || action === 'withdraw'

  const submit = async () => {
    if (!item || !action) return
    setBusy(true)
    setError(null)
    try {
      await gigaFetch(`/api/giga-admin/reports/${item.id}`, { method: 'POST', json: { action, ...(reason.trim() ? { reason: reason.trim() } : {}) } })
      toast.success(action === 'publish' ? `Версия ${item.version} опубликована: клиент видит её` : action === 'reject' ? 'Версия отклонена' : 'Версия отозвана: клиент её больше не видит')
      setAction(null)
      setReason('')
      await q.reload()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение')
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) void q.reload()
    } finally {
      setBusy(false)
    }
  }

  const rerun = async () => {
    if (!item) return
    setRerunning(true)
    try {
      const r = await gigaFetch<{ taskId: string }>('/api/giga-admin/agents/report/run', { method: 'POST', json: { companyId: item.company_id } })
      toast.success('Агент «Отчёт» запущен. Если данные не изменились, новой версии не будет — это видно в задаче.', {
        action: { label: 'К задаче', onClick: () => router.push(`${base}/agents/tasks/${r.taskId}`) },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось запустить агента')
    } finally {
      setRerunning(false)
    }
  }

  const p = item?.provenance
  const narrative = p?.staff?.narrative
  const review = (p as (typeof p & { review?: { action: string; by: string; at: string; reason: string } }) | undefined)?.review

  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-3xl" title={item ? `${item.title} · v${item.version}` : 'Версия отчёта'}>
      {q.error && <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      {!item && q.loading && <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>}
      {item && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip meta={reportStatusMeta(item.status)} />
            {actions.includes('publish') && <Button size="sm" variant="primary" icon={<Check size={12} />} onClick={() => setAction('publish')}>Опубликовать клиенту</Button>}
            {actions.includes('reject') && <Button size="sm" variant="danger" icon={<Ban size={12} />} onClick={() => setAction('reject')}>Отклонить</Button>}
            {actions.includes('withdraw') && <Button size="sm" variant="danger" icon={<Undo2 size={12} />} onClick={() => setAction('withdraw')}>Отозвать</Button>}
            <a href={`/api/giga-admin/reports/${item.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-blue-300 hover:bg-white/[0.04]">
              <ExternalLink size={12} /> PDF
            </a>
            {can.run && <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} loading={rerunning} onClick={() => void rerun()}>Собрать заново</Button>}
          </div>
          {!can.publish && item.status === 'ready' && <NoRightHint>{NO_PUBLISH}.</NoRightHint>}

          <KV items={[
            ['Компания', item.company_name || item.company_id],
            ['Сформировал', createdByLabel(item.created_by)],
            ['Создан', fmtDateTime(item.created_at)],
            item.published_at && ['Опубликован', `${fmtDateTime(item.published_at)} · ${shortActor(item.published_by)}`],
            ['Уверенность', <span key="c" title="Полнота данных, на которых построен отчёт">{fmtConfidence(item.confidence)}</span>],
            ['Хеш данных', <Mono key="h" className="break-all">{item.data_hash}</Mono>],
            p && ['Агент', <span key="a">{p.agent_key} · запуск <Mono>{p.run_ids.map((r) => r.slice(0, 8)).join(', ')}</Mono></span>],
            p && ['Инструменты', <Mono key="t">{p.tools.join(', ')}</Mono>],
            p?.model && ['Модель / промпт', <Mono key="m">{p.model} · {p.prompt_version}</Mono>],
            narrative && ['Резюме ИИ', `${NARRATIVE_STATE_LABELS[narrative.state] ?? narrative.state}${narrative.reason ? ` — ${narrative.reason}` : ''}`],
            p?.staff && ['Не вошло до проверки', `гипотез ИИ ${p.staff.hidden_hypotheses}, предложений модели ${p.staff.unreviewed_model_recommendations}`],
            item.session_id && ['Сессия диагностики', <Mono key="s">{item.session_id}</Mono>],
            review && ['Решение', `${review.action === 'reject' ? 'отклонена' : 'отозвана'} ${fmtDateTime(review.at)} · ${shortActor(review.by)} — «${review.reason}»`],
          ]} />

          <div className={cx('rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4')}>
            <p className="mb-3 text-[11px] uppercase tracking-wider text-slate-500">Снимок, который увидит клиент</p>
            <ReportSnapshotView content={item.content} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!action && !!item}
        onClose={() => { if (!busy) { setAction(null); setError(null) } }}
        onConfirm={() => void submit()}
        loading={busy}
        tone={action === 'publish' ? 'primary' : 'danger'}
        title={action === 'publish' ? `Опубликовать версию ${item?.version} клиенту?` : action === 'reject' ? 'Отклонить версию?' : 'Отозвать опубликованную версию?'}
        confirmLabel={action === 'publish' ? 'Опубликовать' : action === 'reject' ? 'Отклонить' : 'Отозвать'}
        text={action === 'publish'
          ? 'Клиент увидит эту версию в разделе «Точка А» и сможет скачать PDF. Ранее опубликованная версия будет заменена. Решение пишется в журнал аудита.'
          : action === 'reject'
            ? 'Версия не будет показана клиенту. Причину увидят коллеги в карточке версии и в журнале аудита.'
            : 'Клиент перестанет видеть эту версию сразу. Причину увидят коллеги в карточке версии и в журнале аудита.'}
      >
        {needsReason && (
          <Field label="Причина (обязательно)" hint={`${reason.length}/500`}>
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="Например: выручка в документе не совпадает с анкетой" />
          </Field>
        )}
        {needsReason && reason.trim().length < 3 && <p className="mt-1 text-[11px] text-slate-500">Укажите причину — без неё решение не сохранится.</p>}
        {error && <p role="alert" className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
      </ConfirmDialog>
    </Drawer>
  )
}
