'use client'

/**
 * Card of one broadcast (drawer of GIGA «Рассылки»): status, overall and
 * per-channel progress, the text and audience, Запустить / Пауза /
 * Продолжить / Отменить (inbox.manage), and the recipients with the reason of
 * every error or skip.
 *
 * Polls only while the drawer is open, the tab is visible and the broadcast is
 * moving (running / preparing) — no background loops.
 */
import { useCallback, useEffect, useState } from 'react'
import { Ban, Clock, Pause, Play, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Skeleton, Tabs, cx, fmtDateTime, gigaFetch, useGigaQuery, type Tone,
} from '@/components/giga-panel/kit'
import { PROFILE_ROLE, PROFILE_STATUS, USER_SEGMENT_LABELS } from '@/lib/admin/labels'
import { CAMPAIGN_STATUS_LABELS, RECIPIENT_STATUS_LABELS, type CampaignStatus, type RecipientStatus } from '@/lib/comm/campaign-labels'
import { CHANNEL_LABELS, type CommChannel } from '@/lib/comm/types'
import type { CampaignSchedule } from './CampaignWizard'

export interface CampaignItem {
  id: string
  title: string
  subject: string | null
  body: string
  channels: CommChannel[]
  status: CampaignStatus
  audience: { kind: 'filters' | 'users' | 'none'; filters?: { q: string; segment: string; status: string; role: string; assignee: string }; users?: number }
  author: { id: string; name: string } | null
  counts: { total: number; sent: number; failed: number; skipped: number }
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}
interface ChannelProgress { channel: CommChannel; total: number; sent: number; failed: number; skipped: number; left: number }
interface CardResponse { data: CampaignItem & { progress: ChannelProgress[] }; schedule: CampaignSchedule; can: { manage: boolean } }
interface RecipientItem { id: string; userId: string; name: string; email: string | null; channel: CommChannel; status: RecipientStatus; reason: string | null; updatedAt: string }

export const CAMPAIGN_TONE: Record<CampaignStatus, Tone> = {
  draft: 'neutral', scheduled: 'blue', running: 'blue', paused: 'amber', done: 'green', cancelled: 'red',
}

const POLL_MS = 10_000

export function audienceText(a: CampaignItem['audience']): string {
  if (a.kind === 'users') return `выбраны вручную: ${a.users ?? 0}`
  if (a.kind !== 'filters' || !a.filters) return '—'
  const f = a.filters
  const parts = [
    f.segment && (USER_SEGMENT_LABELS[f.segment] ?? f.segment),
    f.status && (PROFILE_STATUS[f.status]?.label ?? f.status),
    f.role && (PROFILE_ROLE[f.role] ?? f.role),
    f.assignee === 'none' ? 'без ответственного' : f.assignee ? 'клиенты сотрудника' : '',
    f.q && `поиск «${f.q}»`,
  ].filter(Boolean)
  return parts.length ? `по фильтрам: ${parts.join(', ')}` : 'все пользователи'
}

export function ProgressBar({ counts, className }: { counts: { total: number; sent: number; failed: number; skipped: number }; className?: string }) {
  const t = Math.max(1, counts.total)
  const pct = (n: number) => `${Math.min(100, (n / t) * 100)}%`
  return (
    <div className={cx('flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]', className)} aria-hidden>
      <span className="bg-emerald-400/80" style={{ width: pct(counts.sent) }} />
      <span className="bg-red-400/80" style={{ width: pct(counts.failed) }} />
      <span className="bg-amber-400/60" style={{ width: pct(counts.skipped) }} />
    </div>
  )
}

export function CampaignCard({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const card = useGigaQuery<CardResponse>(id ? `/api/giga-admin/comm/campaigns/${id}` : null)
  const reload = card.reload
  const status = card.data?.data.status
  const moving = status === 'running' || status === 'scheduled'

  useEffect(() => {
    if (!id || !moving) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, POLL_MS)
    return () => clearInterval(t)
  }, [id, moving, reload])

  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const act = async (action: 'start' | 'pause' | 'resume' | 'cancel') => {
    if (!id) return
    setBusy(action)
    try {
      await gigaFetch(`/api/giga-admin/comm/campaigns/${id}`, { method: 'PATCH', json: { action } })
      toast.success({ start: 'Рассылка запущена', pause: 'Рассылка на паузе', resume: 'Рассылка продолжается', cancel: 'Рассылка отменена' }[action])
      setConfirmCancel(false)
      await reload()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось')
    } finally {
      setBusy(null)
    }
  }

  const c = card.data?.data
  const s = card.data?.schedule
  const manage = card.data?.can.manage ?? false
  const done = c ? c.counts.sent + c.counts.failed + c.counts.skipped : 0

  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-2xl" title={c?.title ?? 'Рассылка'}>
      {card.error && <ErrorState error={card.error} onRetry={() => void reload()} />}
      {!c && card.loading && <Skeleton className="h-48" />}
      {c && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CAMPAIGN_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
            {c.channels.map((ch) => <Badge key={ch}>{CHANNEL_LABELS[ch]}</Badge>)}
            <span className="ml-auto text-[10px] text-slate-500">{c.author?.name ?? '—'} · {fmtDateTime(c.createdAt)}</span>
          </div>

          {manage && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'draft' && <Button variant="primary" size="sm" icon={<Rocket size={12} />} loading={busy === 'start'} disabled={!!busy} onClick={() => void act('start')}>Запустить</Button>}
              {c.status === 'running' && <Button variant="warning" size="sm" icon={<Pause size={12} />} loading={busy === 'pause'} disabled={!!busy} onClick={() => void act('pause')}>Пауза</Button>}
              {c.status === 'paused' && <Button variant="primary" size="sm" icon={<Play size={12} />} loading={busy === 'resume'} disabled={!!busy} onClick={() => void act('resume')}>Продолжить</Button>}
              {(c.status === 'draft' || c.status === 'running' || c.status === 'paused') && (
                <Button variant="danger" size="sm" icon={<Ban size={12} />} disabled={!!busy} onClick={() => setConfirmCancel(true)}>Отменить</Button>
              )}
              <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={() => void reload()}>Обновить</Button>
            </div>
          )}

          {c.status === 'running' && s && !s.open && (
            <p className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-200">
              <Clock size={12} /> Сейчас нерабочее время ({s.window}) — отправка продолжится {s.nextAt ? fmtDateTime(s.nextAt) : 'в начале рабочего дня'}.
            </p>
          )}

          {c.status !== 'draft' && (
            <section className="space-y-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-slate-400">Обработано <b className="tabular-nums text-slate-100">{done}</b> из <b className="tabular-nums text-slate-100">{c.counts.total}</b></p>
                <p className="flex gap-2 text-[11px]">
                  <span className="text-emerald-300">отправлено {c.counts.sent}</span>
                  <span className="text-red-300">ошибок {c.counts.failed}</span>
                  <span className="text-amber-300">не отправлено {c.counts.skipped}</span>
                </p>
              </div>
              <ProgressBar counts={c.counts} />
              <div className="space-y-1.5 pt-1">
                {card.data!.data.progress.map((p) => (
                  <div key={p.channel} className="grid grid-cols-[80px_1fr_auto] items-center gap-2 text-[11px]">
                    <span className="text-slate-300">{CHANNEL_LABELS[p.channel]}</span>
                    <ProgressBar counts={p} />
                    <span className="tabular-nums text-slate-500">{p.sent}/{p.total}{p.failed ? ` · ош. ${p.failed}` : ''}{p.skipped ? ` · пропуск ${p.skipped}` : ''}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600">
                {c.startedAt && <>Запущена {fmtDateTime(c.startedAt)}. </>}
                {c.finishedAt && <>{c.status === 'cancelled' ? 'Отменена' : 'Завершена'} {fmtDateTime(c.finishedAt)}. </>}
                {moving && s && <>Пауза между сообщениями {s.intervalSeconds} с + до {s.jitterSeconds} с.</>}
              </p>
            </section>
          )}

          <section className="space-y-1.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="text-[11px] text-slate-500">Аудитория: <span className="text-slate-300">{audienceText(c.audience)}</span></p>
            {c.subject && <p className="text-[11px] text-slate-500">Тема письма: <span className="text-slate-300">{c.subject}</span></p>}
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">{c.body}</p>
          </section>

          {c.status !== 'draft' && <Recipients campaignId={c.id} version={c.updatedAt} />}
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void act('cancel')}
        loading={busy === 'cancel'}
        title="Отменить рассылку?"
        confirmLabel="Отменить рассылку"
        text="Неотправленные сообщения больше не уйдут. Уже отправленные останутся у пользователей. Отмену нельзя вернуть."
      />
    </Drawer>
  )
}

type RecipientTab = 'failed' | 'skipped' | 'sent' | 'pending'

function Recipients({ campaignId, version }: { campaignId: string; version: string }) {
  const [tab, setTab] = useState<RecipientTab>('failed')
  const [rows, setRows] = useState<RecipientItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<{ message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await gigaFetch<{ data: RecipientItem[]; total: number }>(`/api/giga-admin/comm/campaigns/${campaignId}/recipients?status=${tab}&offset=${offset}`)
      setRows((prev) => (offset ? [...prev, ...res.data] : res.data))
      setTotal(res.total)
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Не удалось загрузить' })
    } finally {
      setLoading(false)
    }
  }, [campaignId, tab])

  // The first page again when the tab changes; errors / skips also when the campaign moved on.
  const refreshKey = tab === 'failed' || tab === 'skipped' ? version : ''
  useEffect(() => { void load(0) }, [load, refreshKey])

  return (
    <section className="space-y-2">
      <Tabs<RecipientTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'failed', label: 'Ошибки' },
          { key: 'skipped', label: 'Не отправлено' },
          { key: 'sent', label: 'Отправлено' },
          { key: 'pending', label: 'В очереди' },
        ]}
      />
      {error && <ErrorState error={error} onRetry={() => void load(0)} />}
      {!loading && !error && rows.length === 0 && <EmptyState title="Пусто" text={tab === 'failed' ? 'Ошибок нет.' : 'Здесь пока никого.'} />}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/admin-giga-panel/messages?user=${r.userId}`} className="truncate text-xs font-medium text-slate-200 hover:underline">{r.name}</a>
              {r.email && <span className="truncate text-[10px] text-slate-500">{r.email}</span>}
              <Badge className="ml-auto">{CHANNEL_LABELS[r.channel]}</Badge>
              <span className="text-[10px] text-slate-500">{RECIPIENT_STATUS_LABELS[r.status]}</span>
            </div>
            {r.reason && <p className="mt-0.5 text-[11px] text-slate-400">{r.reason}</p>}
          </li>
        ))}
      </ul>
      {loading && <Skeleton className="h-10" />}
      {!loading && rows.length < total && (
        <Button size="sm" variant="ghost" onClick={() => void load(rows.length)}>Показать ещё ({total - rows.length})</Button>
      )}
    </section>
  )
}
