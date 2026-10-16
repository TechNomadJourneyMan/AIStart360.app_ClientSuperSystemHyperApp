'use client'

/**
 * GIGA-CRM «Рассылки» — one text to many users over the platform, email,
 * Telegram and WhatsApp (lib/comm/campaigns.ts). The list with status and
 * progress; «Новая рассылка» opens the wizard (text → channels → audience by
 * the users-list filters or by hand → preview → launch); a row opens the card
 * with progress per channel, errors per recipient and Пауза / Продолжить /
 * Отменить. ?id=<campaign> selects the card.
 *
 * Messages go one at a time with a pause (10 s + 0–5 s by default) and only in
 * the working hours of the «Общение» settings. Seeing needs inbox.view;
 * creating and running — inbox.manage.
 */
import { Suspense, useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Clock, Megaphone } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, ErrorState, PageHeader, Tabs, fmtAgo, fmtDateTime, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { CampaignCard, CAMPAIGN_TONE, ProgressBar, audienceText, type CampaignItem } from '@/components/giga-panel/comm/CampaignCard'
import { CampaignWizard, type CampaignSchedule } from '@/components/giga-panel/comm/CampaignWizard'
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '@/lib/comm/campaign-labels'
import { CHANNEL_LABELS } from '@/lib/comm/types'

interface ListResponse { data: CampaignItem[]; schedule: CampaignSchedule; can: { manage: boolean } }
type Filter = '' | CampaignStatus

function BroadcastsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { can } = useStaff()
  const selected = sp.get('id')
  const [filter, setFilter] = useState<Filter>('')
  const [wizard, setWizard] = useState(false)
  const list = useGigaQuery<ListResponse>(`/api/giga-admin/comm/campaigns${filter ? `?status=${filter}` : ''}`)
  const reload = list.reload

  const select = useCallback((id: string | null) => {
    router.replace(id ? `${pathname}?id=${id}` : pathname, { scroll: false })
  }, [router, pathname])

  const s = list.data?.schedule
  const columns: Column<CampaignItem>[] = [
    {
      key: 'title', header: 'Рассылка',
      render: (c) => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate text-xs font-medium text-slate-200">{c.title}</p>
          <p className="truncate text-[10px] text-slate-500">{audienceText(c.audience)}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Статус', render: (c) => <Badge tone={CAMPAIGN_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge> },
    { key: 'channels', header: 'Каналы', render: (c) => <span className="text-[11px] text-slate-400">{c.channels.map((ch) => CHANNEL_LABELS[ch]).join(', ')}</span> },
    {
      key: 'progress', header: 'Прогресс',
      render: (c) => c.status === 'draft' ? <span className="text-[11px] text-slate-600">—</span> : (
        <div className="w-36">
          <ProgressBar counts={c.counts} />
          <p className="mt-1 text-[10px] tabular-nums text-slate-500">
            {c.counts.sent} отпр. · {c.counts.failed} ош. · {c.counts.skipped} проп. / {c.counts.total}
          </p>
        </div>
      ),
    },
    { key: 'author', header: 'Автор', render: (c) => <span className="text-[11px] text-slate-400">{c.author?.name ?? '—'}</span> },
    { key: 'created', header: 'Создана', render: (c) => <span title={fmtDateTime(c.createdAt)} className="text-[11px] text-slate-500">{fmtAgo(c.createdAt)}</span> },
  ]

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Рассылки' }]}
        title="Рассылки"
        description="Одно сообщение многим пользователям — в кабинет, на почту, в Telegram и WhatsApp. Аудитория — по фильтрам списка пользователей или вручную; отправка по одному, только в рабочие часы."
        actions={can('inbox.manage') && <Button variant="primary" size="sm" icon={<Megaphone size={13} />} onClick={() => setWizard(true)}>Новая рассылка</Button>}
      />

      {s && (
        <p className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
          <Clock size={12} className={s.open ? 'text-emerald-300' : 'text-amber-300'} />
          Рабочие часы рассылок: <b className="text-slate-200">{s.window}</b>, пауза {s.intervalSeconds} с + до {s.jitterSeconds} с.
          {s.open ? <span className="text-emerald-300">Сейчас окно открыто.</span> : s.nextAt && <span className="text-amber-300">Сейчас нерабочее время — следующее окно {fmtDateTime(s.nextAt)}.</span>}
          {can('users.manage') && <a href="/admin-giga-panel/settings" className="ml-auto text-blue-300 hover:underline">Настройки «Общение»</a>}
        </p>
      )}

      <Tabs<Filter>
        className="mb-3"
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: '', label: 'Все' },
          { key: 'running', label: 'Идут' },
          { key: 'paused', label: 'На паузе' },
          { key: 'draft', label: 'Черновики' },
          { key: 'done', label: 'Завершены' },
          { key: 'cancelled', label: 'Отменены' },
        ]}
      />

      {list.error && <ErrorState error={list.error} onRetry={() => void reload()} />}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
        <DataTable
          columns={columns}
          rows={list.data?.data}
          rowKey={(c) => c.id}
          loading={list.loading && !list.data}
          onRowClick={(c) => select(c.id)}
          empty={filter ? 'Рассылок с таким статусом нет' : 'Рассылок пока нет — создайте первую кнопкой «Новая рассылка»'}
        />
      </div>

      <CampaignCard id={selected} onClose={() => { select(null); void reload() }} onChanged={() => void reload()} />
      <CampaignWizard
        open={wizard}
        onClose={() => setWizard(false)}
        schedule={s ?? null}
        onCreated={(id) => { setWizard(false); void reload(); select(id) }}
      />
    </>
  )
}

export function BroadcastsPage() {
  return (
    <RequirePermission permission="inbox.view">
      <Suspense fallback={null}>
        <BroadcastsInner />
      </Suspense>
    </RequirePermission>
  )
}
