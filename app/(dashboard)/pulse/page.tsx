'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import {
  useCrmToday, useCrmClients, useLogInteraction, useCrmInteractions, touchErrorText, type CrmClient, type CrmTodayClient,
} from '@/hooks/useCrm'
import { ClientsTable } from '@/components/crm/ClientsTable'
import { ClientDrawer, type DrawerClient } from '@/components/crm/ClientDrawer'
import { CsvImportDialog } from '@/components/crm/CsvImportDialog'
import { seedFromClientRow, seedFromQueueRow } from '@/lib/crm/client-form'
import { pickCardClient } from '@/lib/crm/card-client'
import { portfolioAverageCheck, toTodayClient } from '@/lib/crm/today'
import { briefingNetworkError, briefingSegments, briefingView, type BriefingView } from '@/lib/crm/briefing-answer'
import type { CrmProvider, CrmStatus } from '@/lib/crm/types'
import { CRM_AUTO_SYNC_DESCRIPTION, CRM_AVG_CHECK_DESCRIPTION, CRM_SYNC_STATUS_LABEL, normaliseSyncStatus, type CrmSyncStatus } from '@/lib/crm/sync-status'

// ─── Adapters → the drawer's minimal client seed ─────────────────────────────
const crmToDrawer = (c: CrmClient): DrawerClient => seedFromClientRow(c)
// Queue / risk rows carry the raw phone too (seedFromQueueRow) — the drawer must not lose it (L6).
const pulseToDrawer = (c: PulseClient): DrawerClient => seedFromQueueRow(c)

// recharts lives inside GriPulseWidget — load it lazily so it stays out of this
// (already large) pulse page's first-load JS.
const GriPulseWidget = dynamic(() => import('@/components/pulse/GriPulseWidget'), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-surface-container-low rounded-2xl" />,
})

// ─── Action Modals ─────────────────────────────────────────────────────────────
type ModalClient = { id: string; name: string; sector: string; phone?: string | null }

function CallModal({ client, onClose }: { client: ModalClient | null; onClose: () => void }) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'done'>('idle')
  const [note, setNote] = useState('')
  const logInteraction = useLogInteraction()
  // Reset when a new client is opened.
  useEffect(() => { setStatus('idle'); setNote('') }, [client?.id])
  if (!client) return null
  const digits = (client.phone ?? '').replace(/\D/g, '')

  const record = () => {
    logInteraction.mutate(
      { clientId: client.id, kind: 'call', comment: note.trim() || undefined },
      {
        onSuccess: () => { setStatus('done'); toast.success('Звонок зафиксирован') },
        onError: (e: unknown) => toast.error(touchErrorText(e)),
      },
    )
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#13151c] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl z-10">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-error/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-error">call</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">{client.name}</p>
              <p className="text-[10px] text-on-surface-variant">{client.sector}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {status === 'done' ? (
            <div className="text-center py-4">
              <span className="material-symbols-outlined text-4xl text-primary block mb-2">check_circle</span>
              <p className="text-sm font-medium text-on-surface">Звонок зафиксирован</p>
              <p className="text-xs text-on-surface-variant mt-1">Касание сохранено в истории клиента</p>
            </div>
          ) : (
            <>
              {digits ? (
                <a href={`tel:${client.phone ?? digits}`}
                  className="flex items-center justify-center gap-2 bg-error/10 hover:bg-error/20 border border-error/20 text-error text-sm font-mono px-3 py-2.5 rounded-xl transition-colors">
                  <span className="material-symbols-outlined text-sm">phone_forwarded</span>
                  {client.phone ?? digits}
                </a>
              ) : (
                <p className="text-xs text-on-surface-variant text-center bg-surface-container rounded-xl px-3 py-2.5">
                  Телефон не указан — добавьте его в карточке клиента
                </p>
              )}
              <textarea
                value={note} onChange={e => setNote(e.target.value)}
                placeholder="Заметка о звонке (результат, следующий шаг)..."
                rows={3}
                className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors">
                  Отмена
                </button>
                <button
                  onClick={record}
                  disabled={logInteraction.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-error/10 border border-error/20 text-sm text-error font-medium hover:bg-error/20 disabled:opacity-40 transition-colors">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">check</span>
                  Зафиксировать
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageModal({ client, onClose }: { client: ModalClient | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const logInteraction = useLogInteraction()
  useEffect(() => { setSent(false); setText('') }, [client?.id])
  if (!client) return null
  const digits = (client.phone ?? '').replace(/\D/g, '')
  const templates = [
    `Здравствуйте! Хотели уточнить статус нашего сотрудничества и обсудить следующие шаги.`,
    `Добрый день! Заметили изменение в активности и хотели предложить встречу для обсуждения программы.`,
    `Привет! Подготовили для вас обновлённое предложение — когда удобно обсудить?`,
  ]

  const send = () => {
    // Open WhatsApp with the drafted text pre-filled where we have a number.
    if (digits) {
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank')
    }
    logInteraction.mutate(
      { clientId: client.id, kind: 'message', comment: text.trim() || undefined },
      {
        onSuccess: () => { setSent(true); toast.success('Сообщение зафиксировано') },
        onError: (e: unknown) => toast.error(touchErrorText(e)),
      },
    )
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#13151c] border border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl z-10">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-tertiary-container/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-tertiary-container">chat</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">{client.name}</p>
              <p className="text-[10px] text-on-surface-variant">{client.sector}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {sent ? (
            <div className="text-center py-4">
              <span className="material-symbols-outlined text-4xl text-primary block mb-2">mark_email_read</span>
              <p className="text-sm font-medium text-on-surface">Сообщение зафиксировано</p>
              <p className="text-xs text-on-surface-variant mt-1">Касание сохранено в истории клиента</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Шаблоны</p>
              <div className="space-y-2">
                {templates.map((t, i) => (
                  <button key={i} onClick={() => setText(t)}
                    className="w-full text-left text-xs text-on-surface-variant bg-surface-container hover:bg-surface-container-high border border-white/[0.04] rounded-xl px-3 py-2 transition-colors line-clamp-2">
                    {t}
                  </button>
                ))}
              </div>
              <textarea
                value={text} onChange={e => setText(e.target.value)}
                placeholder="Или напишите своё сообщение..."
                rows={3}
                className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors">
                  Отмена
                </button>
                <button onClick={send} disabled={!text.trim() || logInteraction.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-tertiary-container/10 border border-tertiary-container/20 text-sm text-tertiary-container font-medium hover:bg-tertiary-container/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">send</span>
                  {digits ? 'Открыть WhatsApp' : 'Зафиксировать'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}Млрд ₸`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}М ₸`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}К ₸`
  return `${n} ₸`
}

/** An average check, or «—» when the owner has not entered one (never 0 ₸). */
function fmtCheck(n: number | null) {
  return n == null ? '—' : fmt(n)
}

/** «нет касаний» for a client never contacted, else «N дн. назад». */
function fmtDaysSince(d: number | null) {
  return d == null ? 'нет касаний' : `${d} дн. назад`
}

function fmtDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Why a client is in today's queue (lib/crm/today.ts queueBucket). */
const BUCKET_LABEL: Record<number, string> = {
  0: 'Просрочен контакт',
  1: 'Контакт на сегодня',
  2: 'Нет плана контакта',
  3: 'Спящий > 30 дн.',
}

// The risk level of the heuristic score — a level, not a probability (no «%»).
function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const cfg = {
    high:   { bg: 'bg-error/10 border-error/30 text-error',         dot: 'bg-error',         label: 'Высокий' },
    medium: { bg: 'bg-tertiary-container/10 border-tertiary-container/30 text-tertiary-container', dot: 'bg-tertiary-container', label: 'Средний' },
    low:    { bg: 'bg-primary/10 border-primary/30 text-primary',   dot: 'bg-primary',        label: 'Низкий'  },
  }[level]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono font-medium ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label} риск
    </span>
  )
}

// ActionBtn is context-aware — clicks are handled by PulsePage via onCall/onMessage/onMonitor props
// When used standalone (ClientCard actions row), it fires a window custom event
function ActionBtn({ action, size = 'md', onClick }: { action: 'call' | 'message' | 'monitor'; size?: 'sm' | 'md'; onClick?: () => void }) {
  const cfg = {
    call:    { bg: 'bg-error/10 hover:bg-error/20 text-error border-error/20',             icon: 'call',          label: 'Позвонить'    },
    message: { bg: 'bg-tertiary-container/10 hover:bg-tertiary-container/20 text-tertiary-container border-tertiary-container/20', icon: 'chat',          label: 'Написать'     },
    monitor: { bg: 'bg-primary/10 hover:bg-primary/20 text-primary border-primary/20',     icon: 'visibility',    label: 'Мониторинг'   },
  }[action]
  const px = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className={`inline-flex items-center gap-1.5 ${px} rounded-lg border text-xs font-medium transition-colors ${cfg.bg}`}>
      <span className="material-symbols-outlined text-sm">{cfg.icon}</span>
      {cfg.label}
    </button>
  )
}

/** The check against the base's average, «—» when either is unknown. Not an order-volume trend. */
function fmtCheckVsAvg(p: number | null) {
  return p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`
}

function RiskBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-error' : score >= 50 ? 'bg-tertiary-container' : 'bg-primary'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold min-w-[24px] ${color.replace('bg-', 'text-')}`}>{score}</span>
    </div>
  )
}

// A row of GET /api/v1/crm/today (queue or risk list) + `sector` (the status label) for the modals.
// Only the owner's own data: no order history, order cycle or volume trend exists on the platform.
type PulseClient = CrmTodayClient & { sector: string }

// Real touches from crm_interactions (the card's history — not an invented order series).
function RecentTouches({ clientId }: { clientId: string }) {
  const { data = [], isLoading, error } = useCrmInteractions(clientId)
  const KIND: Record<string, string> = { call: 'Звонок', message: 'Сообщение', meeting: 'Встреча', note: 'Заметка', status_change: 'Смена статуса' }
  if (isLoading) return <p className="text-xs text-on-surface-variant/60">Загрузка…</p>
  if (error) return <p className="text-xs text-error">Не удалось загрузить касания</p>
  if (data.length === 0) return <p className="text-xs text-on-surface-variant/60">Касаний пока не было</p>
  return (
    <ul className="space-y-1.5">
      {data.slice(0, 5).map((it) => (
        <li key={it.id} className="flex items-baseline gap-2 text-xs">
          <span className="font-mono text-on-surface-variant/70 w-16 flex-shrink-0">{fmtDate(it.created_at) ?? '—'}</span>
          <span className="text-on-surface truncate">{it.comment || KIND[it.kind] || it.kind}</span>
        </li>
      ))}
    </ul>
  )
}

// ─── Client Card Tab ──────────────────────────────────────────────────────────
function ClientCard({ client, onCall, onMessage, onMonitor, onHistory, isMonitored }: {
  client: PulseClient
  onCall?: () => void
  onMessage?: () => void
  onMonitor?: () => void
  onHistory?: () => void
  isMonitored?: boolean
}) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary flex-shrink-0">
          {client.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-headline text-xl font-bold text-on-surface">{client.name}</h3>
            <RiskBadge level={client.churnLevel} />
          </div>
          <p className="text-sm text-on-surface-variant">
            {[
              client.sector,
              client.queueBucket != null ? BUCKET_LABEL[client.queueBucket] : null,
              fmtDate(client.nextContactAt) ? `Следующий контакт: ${fmtDate(client.nextContactAt)}` : 'Следующий контакт не запланирован',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <ActionBtn action={client.action}
          onClick={client.action === 'call' ? onCall : client.action === 'message' ? onMessage : onMonitor} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Средний чек', value: client.avgCheck == null ? 'не указан' : fmt(client.avgCheck), icon: 'payments', color: client.avgCheck == null ? 'on-surface-variant' : 'primary' },
          { label: 'Чек к среднему', value: fmtCheckVsAvg(client.checkVsAvgPct), icon: 'balance', color: 'on-surface-variant' },
          { label: 'Риск-скор',   value: String(client.riskScore), icon: 'warning', color: client.riskScore >= 80 ? 'error' : 'tertiary-container' },
          { label: 'Без касания', value: client.daysSince == null ? 'нет касаний' : `${client.daysSince} дн.`, icon: 'schedule', color: 'on-surface-variant' },
        ].map((m) => (
          <div key={m.label} className="bg-surface-container rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`material-symbols-outlined text-sm text-${m.color}`}>{m.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{m.label}</p>
            </div>
            <p className={`text-lg font-mono font-bold text-${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Real touches (crm_interactions) — the platform has no order data */}
      <div className="bg-surface-container rounded-xl p-4">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">Последние касания</p>
        <RecentTouches clientId={client.id} />
      </div>

      {/* Comment */}
      <div className="bg-surface-container rounded-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-sm text-on-surface-variant flex-shrink-0 mt-0.5">comment</span>
        <p className="text-sm text-on-surface-variant">{client.comment ?? client.note ?? 'Без комментария'}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <ActionBtn action="call" onClick={onCall} />
        <ActionBtn action="message" onClick={onMessage} />
        <button onClick={onMonitor}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            isMonitored
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-white/[0.06] text-on-surface-variant hover:bg-white/[0.04]'
          }`}>
          <span className="material-symbols-outlined text-sm">{isMonitored ? 'visibility' : 'visibility_off'}</span>
          {isMonitored ? 'Мониторинг вкл.' : 'Мониторинг'}
        </button>
        <button onClick={onHistory}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.06] text-xs font-medium text-on-surface-variant hover:bg-white/[0.04] transition-colors">
          <span className="material-symbols-outlined text-sm">history</span>
          История
        </button>
      </div>
    </div>
  )
}

// ─── CRM Integration Tab ──────────────────────────────────────────────────────
function CrmIntegrationTab() {
  const [integrations, setIntegrations] = useState<CrmStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  const [connectProvider, setConnectProvider] = useState<CrmProvider>('bitrix24')
  const [connectDomain, setConnectDomain] = useState('')
  const [connectToken, setConnectToken] = useState('')
  const [connectWebhook, setConnectWebhook] = useState('')
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  // Фаза 4B: живой бэкенд /api/v1/crm/connections (RLS own) вместо мёртвого
  // /api/crm (requireCrmOrg=null → 403). Маплем snake_case строки в CrmStatus,
  // чтобы не трогать разметку ниже.
  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/crm/connections', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      const rows = (json?.data ?? []) as Array<Record<string, unknown>>
      setIntegrations(
        rows.map((r) => ({
          id: String(r.id),
          provider: r.provider as CrmProvider,
          domain: String(r.base_url ?? ''),
          isActive: Boolean(r.is_active),
          lastSyncAt: (r.last_sync_at as string | null) ?? null,
          // One vocabulary (lib/crm/sync-status.ts): the legacy 'ok' reads as success (M7).
          lastSyncStatus: normaliseSyncStatus(r.last_sync_status),
          lastSyncError: (r.last_sync_error as string | null) ?? null,
          syncedDeals: Number(r.synced_deals ?? 0),
          syncedContacts: Number(r.synced_contacts ?? 0),
          createdAt: String(r.created_at ?? ''),
        })),
      )
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

  const handleSync = async (id: string) => {
    setSyncingId(id)
    try {
      const res = await fetch(`/api/v1/crm/connections/${id}/sync`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      const message = typeof data?.data?.message === 'string' ? data.data.message : null
      if (res.ok && data.ok) {
        if (data.data?.status === 'partial') toast.warning(message || 'Синхронизация выполнена частично')
        else toast.success(message || 'Синхронизация выполнена')
      } else {
        toast.error(data.error || 'Не удалось синхронизировать')
      }
      await fetchIntegrations()
    } catch {
      toast.error('Ошибка сети при синхронизации')
    }
    setSyncingId(null)
  }

  const handleConnect = async () => {
    setConnectLoading(true)
    setConnectError(null)
    try {
      // Bitrix24: домен извлекаем из webhook-URL, сам URL кладём как access_token
      // (provider-client распознаёт полный URL как webhook-режим).
      const payload = connectProvider === 'bitrix24'
        ? {
            provider: 'bitrix24',
            base_url: connectWebhook.replace(/^https?:\/\//, '').split('/')[0],
            access_token: connectWebhook,
          }
        : {
            provider: 'amocrm',
            base_url: connectDomain,
            access_token: connectToken,
          }

      const res = await fetch('/api/v1/crm/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setConnectError(data.error || 'Ошибка подключения')
        setConnectLoading(false)
        return
      }
      setShowConnect(false)
      setConnectDomain('')
      setConnectToken('')
      setConnectWebhook('')
      toast.success('CRM подключена — загружаем клиентов')
      await fetchIntegrations()
      // The first sync right away; afterwards the automatic one keeps it fresh.
      if (typeof data?.data?.id === 'string') void handleSync(data.data.id)
    } catch {
      setConnectError('Ошибка сети')
    }
    setConnectLoading(false)
  }

  const handleDisconnect = async (id: string) => {
    if (!confirm('Отключить CRM-интеграцию?')) return
    try {
      const res = await fetch(`/api/v1/crm/connections/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) toast.success('CRM отключена')
      await fetchIntegrations()
    } catch { /* empty */ }
  }

  const providerInfo = {
    bitrix24: {
      name: 'Bitrix24',
      icon: 'apartment',
      color: 'text-blue-400',
      bg: 'bg-blue-400/10 border-blue-400/20',
      gradient: 'from-blue-500/20 to-blue-600/5',
      domainHint: 'mycompany.bitrix24.kz',
      tokenLabel: 'Адрес входящего вебхука',
      docs: 'https://dev.1c-bitrix.ru/rest_help/',
    },
    amocrm: {
      name: 'AmoCRM',
      icon: 'hub',
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10 border-cyan-400/20',
      gradient: 'from-cyan-500/20 to-cyan-600/5',
      domainHint: 'mycompany.amocrm.ru',
      tokenLabel: 'Долгосрочный токен',
      docs: 'https://www.amocrm.ru/developers/',
    },
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-xl text-primary">sync</span>
            CRM-интеграции
          </h2>
          <p className="text-xs text-on-surface-variant mt-1">
            Контакты из Bitrix24 или amoCRM становятся клиентами портала, суммы их сделок — средним чеком.
            Портал только читает CRM и ничего в ней не меняет.
          </p>
          <p className="text-[11px] text-on-surface-variant/70 mt-1">{CRM_AUTO_SYNC_DESCRIPTION}</p>
          <p className="text-[11px] text-on-surface-variant/70 mt-1">{CRM_AVG_CHECK_DESCRIPTION}</p>
        </div>
        <button
          onClick={() => setShowConnect(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          Подключить CRM
        </button>
      </div>

      {/* Available CRM cards (when no integrations) */}
      {integrations.length === 0 && !showConnect && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['bitrix24', 'amocrm'] as const).map(provider => {
            const info = providerInfo[provider]
            return (
              <div key={provider}
                className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br ${info.gradient} p-6 group hover:border-white/[0.12] transition-all cursor-pointer`}
                onClick={() => { setConnectProvider(provider); setShowConnect(true) }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-2xl ${info.bg} flex items-center justify-center`}>
                    <span className={`material-symbols-outlined text-2xl ${info.color}`}>{info.icon}</span>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant/30 group-hover:text-primary/60 transition-colors text-xl">arrow_forward</span>
                </div>
                <h3 className="text-lg font-bold text-on-surface mb-1">{info.name}</h3>
                <p className="text-xs text-on-surface-variant mb-4">
                  {provider === 'bitrix24'
                    ? 'Контакты → клиенты, суммы сделок → средний чек. Подключение — входящий вебхук с правом «CRM».'
                    : 'Контакты → клиенты, суммы сделок → средний чек. Подключение — долгосрочный токен.'}
                </p>
                <div className="flex items-center gap-4 text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">handshake</span> Сделки
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">contacts</span> Контакты
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">sync</span> Авто-синк
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Connected integrations */}
      {integrations.length > 0 && (
        <div className="space-y-4">
          {integrations.map(crm => {
            const info = providerInfo[crm.provider as CrmProvider] || providerInfo.bitrix24
            const isSyncing = syncingId === crm.id
            return (
              <div key={crm.id}
                className="rounded-2xl border border-white/[0.06] bg-surface-container-low overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 gap-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-11 h-11 rounded-xl ${info.bg} flex items-center justify-center flex-shrink-0`}>
                      <span className={`material-symbols-outlined text-xl ${info.color}`}>{info.icon}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-on-surface">{info.name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                          crm.isActive
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-error/10 text-error border border-error/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${crm.isActive ? 'bg-primary' : 'bg-error'}`} />
                          {crm.isActive ? 'Активно' : 'Отключено'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant font-mono mt-0.5">{crm.domain}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => handleSync(crm.id)}
                      disabled={isSyncing}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
                    >
                      <span className={`material-symbols-outlined text-sm ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                      {isSyncing ? 'Синхронизация...' : 'Синхронизировать'}
                    </button>
                    <button
                      onClick={() => handleDisconnect(crm.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.06] text-on-surface-variant text-xs hover:text-error hover:border-error/20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">link_off</span>
                    </button>
                  </div>
                </div>

                {/* Sync stats */}
                <div className="border-t border-white/[0.04] px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Сделки</p>
                    <p className="text-lg font-mono font-bold text-on-surface">{crm.syncedDeals}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Контакты</p>
                    <p className="text-lg font-mono font-bold text-on-surface">{crm.syncedContacts}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Последняя синхр.</p>
                    <p className="text-xs font-mono text-on-surface">
                      {crm.lastSyncAt ? new Date(crm.lastSyncAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Статус</p>
                    <p className={`text-xs font-mono font-medium ${
                      crm.lastSyncStatus === 'success' ? 'text-primary' :
                      crm.lastSyncStatus === 'partial' ? 'text-tertiary-container' :
                      crm.lastSyncStatus === 'error' ? 'text-error' : 'text-on-surface-variant'
                    }`}>
                      {crm.lastSyncStatus ? CRM_SYNC_STATUS_LABEL[crm.lastSyncStatus as CrmSyncStatus] : crm.lastSyncAt ? '—' : 'Ещё не было'}
                    </p>
                    {crm.lastSyncError && (
                      <p className={`text-[10px] mt-0.5 truncate max-w-[200px] ${crm.lastSyncStatus === 'error' ? 'text-error/70' : 'text-on-surface-variant'}`} title={crm.lastSyncError}>{crm.lastSyncError}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Connect modal */}
      {showConnect && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowConnect(false)} />
          <div className="relative bg-[#13151c] border border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl z-10">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${providerInfo[connectProvider].bg} flex items-center justify-center`}>
                  <span className={`material-symbols-outlined text-xl ${providerInfo[connectProvider].color}`}>
                    {providerInfo[connectProvider].icon}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">Подключить {providerInfo[connectProvider].name}</p>
                  <p className="text-[10px] text-on-surface-variant">Введите данные для подключения</p>
                </div>
              </div>
              <button onClick={() => setShowConnect(false)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Provider selector */}
              <div className="flex gap-2">
                {(['bitrix24', 'amocrm'] as const).map(p => (
                  <button key={p} onClick={() => setConnectProvider(p)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                      connectProvider === p
                        ? `${providerInfo[p].bg} ${providerInfo[p].color}`
                        : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface'
                    }`}>
                    <span className="material-symbols-outlined text-sm">{providerInfo[p].icon}</span>
                    {providerInfo[p].name}
                  </button>
                ))}
              </div>

              {connectProvider === 'bitrix24' ? (
                /* Bitrix24: only Webhook URL needed */
                <div>
                  <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1.5">
                    Webhook URL
                  </label>
                  <input
                    type="text"
                    value={connectWebhook}
                    onChange={e => setConnectWebhook(e.target.value)}
                    placeholder="https://b24-xxx.bitrix24.kz/rest/1/ваш_секрет/"
                    className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 font-mono text-xs"
                  />
                  <ol className="text-[11px] text-on-surface-variant mt-2 pl-4 space-y-1 list-decimal">
                    <li>В Bitrix24 откройте «Разработчикам» → «Другое» → «Входящий вебхук».</li>
                    <li>В «Настройке прав» отметьте «CRM (crm)» и нажмите «Сохранить».</li>
                    <li>Скопируйте «Вебхук для вызова rest api» — адрес вида https://ваш-портал.bitrix24.kz/rest/1/код/ — и вставьте сюда.</li>
                  </ol>
                </div>
              ) : (
                /* AmoCRM: domain + API key */
                <>
                  <div>
                    <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1.5">Домен</label>
                    <input
                      type="text"
                      value={connectDomain}
                      onChange={e => setConnectDomain(e.target.value)}
                      placeholder={providerInfo[connectProvider].domainHint}
                      className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1.5">
                      {providerInfo[connectProvider].tokenLabel}
                    </label>
                    <input
                      type="password"
                      value={connectToken}
                      onChange={e => setConnectToken(e.target.value)}
                      placeholder="Вставьте долгосрочный токен…"
                      className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 font-mono"
                    />
                    <ol className="text-[11px] text-on-surface-variant mt-2 pl-4 space-y-1 list-decimal">
                      <li>В amoCRM откройте «amoМаркет» → «⋯» → «Создать интеграцию» → «Внешняя интеграция», дайте ей доступ к данным аккаунта и сохраните.</li>
                      <li>В интеграции на вкладке «Ключи и доступы» сгенерируйте долгосрочный токен, выберите срок действия и скопируйте его.</li>
                      <li>Домен — адрес аккаунта вида ваш-аккаунт.amocrm.ru. Когда срок токена закончится, создайте новый и подключите заново.</li>
                    </ol>
                  </div>
                </>
              )}

              {/* Docs link */}
              <a href={providerInfo[connectProvider].docs} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-sm">menu_book</span>
                Документация API {providerInfo[connectProvider].name}
              </a>

              {connectError && (
                <div className="flex items-center gap-2 bg-error/10 border border-error/20 rounded-xl px-3 py-2.5">
                  <span className="material-symbols-outlined text-sm text-error">error</span>
                  <p className="text-xs text-error">{connectError}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowConnect(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors">
                  Отмена
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connectLoading || (connectProvider === 'bitrix24' ? !connectWebhook : (!connectDomain || !connectToken))}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary/20 border border-primary/30 text-sm text-primary font-medium hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {connectLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                      Проверка...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-sm">check</span>
                      Подключить
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
// Top-level page: CRM client work (primary) + GRI Pulse weekly survey (collapsed,
// at the bottom — PO's explicit request to move the pulse sliders down).
export default function PulsePage() {
  const [pulseOpen, setPulseOpen] = useState(false)
  return (
    <div className="space-y-10">
      {/* ── Primary: CRM client work ── */}
      <CrmMonitorSection />

      {/* ── Secondary: GRI Pulse weekly survey (collapsible, bottom) ── */}
      <div className="space-y-4">
        <button
          data-tour="pulse-week"
          onClick={() => setPulseOpen(v => !v)}
          className="w-full flex items-center gap-3 pt-4 border-t border-white/[0.04] text-left group"
        >
          <span className="material-symbols-outlined text-lg text-on-surface-variant group-hover:text-primary transition-colors">cell_tower</span>
          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-[0.2em]">
            Пульс недели
          </p>
          <span className="material-symbols-outlined text-lg text-on-surface-variant ml-auto transition-transform">
            {pulseOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>
        {pulseOpen && <GriPulseWidget />}
      </div>
    </div>
  )
}

/** Russian plural (1 / 2-4 / 5+). */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/** /api/v1/crm/today failed: say so where its data would be — the other tabs keep working (L7). */
function TodayFailed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="p-6 text-center bg-error/10 rounded-2xl border border-error/20">
      <p className="text-error font-medium">Не удалось загрузить очередь «Кому звонить сегодня»</p>
      <p className="text-xs text-on-surface-variant mt-2">
        Риски и карточки клиентов сейчас недоступны. Вкладки «База клиентов» и «CRM-интеграции» работают.
      </p>
      <button onClick={onRetry} disabled={retrying}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-error/30 text-xs text-error hover:bg-error/10 disabled:opacity-40 transition-colors">
        <span className={`material-symbols-outlined text-sm ${retrying ? 'animate-spin' : ''}`}>{retrying ? 'progress_activity' : 'refresh'}</span>
        Повторить
      </button>
    </div>
  )
}

function TodayLoading() {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )
}

/** The briefing request may not hang the block: abort after the route's own 60 s deadline. */
const BRIEFING_TIMEOUT_MS = 70_000

const withSector = (m: CrmTodayClient): PulseClient => ({ ...m, sector: m.statusLabel })

function CrmMonitorSection() {
  const [tab, setTab] = useState<'today' | 'base' | 'risk' | 'card' | 'crm'>('today')
  // Own CRM base — «Кому звонить сегодня» queue, risk list + KPI (lib/crm/today.ts).
  const { data: clientsData, isLoading, error, refetch, isFetching } = useCrmToday()
  const todayFailed = !!error && !clientsData
  const todayReady = !!clientsData
  const logInteraction = useLogInteraction()

  // L9: «Мониторинг» is a per-session marker only (not persisted: there is no column for it).
  const [monitored, setMonitored]         = useState<Set<string>>(new Set())
  const [callClient, setCallClient]       = useState<ModalClient | null>(null)
  const [messageClient, setMessageClient] = useState<ModalClient | null>(null)
  const [filterRisk, setFilterRisk]       = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [briefing, setBriefing]           = useState<BriefingView | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [drawerClient, setDrawerClient]   = useState<DrawerClient | null>(null)
  const [importOpen, setImportOpen]       = useState(false)

  const toggleMonitor = (id: string) =>
    setMonitored(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // ── Real contact actions (tel:/wa.me) + interaction logging ──
  const doCall = useCallback((c: PulseClient) => {
    const digits = (c.phone ?? '').replace(/\D/g, '')
    if (!digits) {
      toast.error('У клиента не указан телефон', { description: 'Добавьте номер в карточке клиента' })
      return
    }
    window.open(`tel:${c.phone ?? digits}`, '_self')
    logInteraction.mutate(
      { clientId: c.id, kind: 'call', comment: 'Звонок из очереди «Сегодня»' },
      {
        onSuccess: () => toast.success(`Звонок ${c.name} зафиксирован`),
        onError: (e: unknown) => toast.error(touchErrorText(e)),
      },
    )
  }, [logInteraction])

  const doMessage = useCallback((c: PulseClient) => {
    const digits = (c.phone ?? '').replace(/\D/g, '')
    if (!digits) {
      toast.error('У клиента не указан телефон', { description: 'Добавьте номер в карточке клиента' })
      return
    }
    window.open(`https://wa.me/${digits}`, '_blank')
    logInteraction.mutate(
      { clientId: c.id, kind: 'message', comment: 'Сообщение в WhatsApp' },
      {
        onSuccess: () => toast.success(`Сообщение ${c.name} зафиксировано`),
        onError: (e: unknown) => toast.error(touchErrorText(e)),
      },
    )
  }, [logInteraction])

  // Fire the right real action for a queue row (call → tel:, message → wa.me, monitor → toggle).
  const runAction = useCallback((c: PulseClient) => {
    if (c.action === 'call') doCall(c)
    else if (c.action === 'message') doMessage(c)
    else toggleMonitor(c.id)
  }, [doCall, doMessage])

  const TODAY_CLIENTS = useMemo<PulseClient[]>(
    () => (clientsData?.todayClients ?? []).map(withSector), [clientsData])
  // The base's high/medium-risk clients (not only today's queue: a handled or lost client is still at risk).
  const RISK_CLIENTS = useMemo<PulseClient[]>(
    () => (clientsData?.riskClients ?? []).map(withSector), [clientsData])

  // The card keeps the client the owner chose, BY ID, and derives the row from fresh data (after a
  // refetch the card is never a stale snapshot). It never falls back to another person: a logged
  // touch takes the client off the queue / risk lists, and the card used to jump to the first
  // client then — «Написать» opened WhatsApp for, and logged a message on, the wrong person.
  // lib/crm/card-client.ts: the lists' row, else the whole base's row, else an empty state.
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [lastKnownCard, setLastKnownCard] = useState<PulseClient | null>(null)
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set())
  const CARD_CLIENTS = useMemo(() => {
    const seen = new Set<string>()
    return [...TODAY_CLIENTS, ...RISK_CLIENTS].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  }, [TODAY_CLIENTS, RISK_CLIENTS])
  // Nothing chosen yet: the tab shows the first client — and that becomes the choice (pinned), so a
  // refetch never swaps the person on the card. Only the owner's click changes it after that.
  const cardId = selectedClientId ?? CARD_CLIENTS[0]?.id ?? null
  useEffect(() => {
    if (tab === 'card' && selectedClientId == null && cardId != null) setSelectedClientId(cardId)
  }, [tab, selectedClientId, cardId])
  const listedCard = useMemo(() => CARD_CLIENTS.find((c) => c.id === cardId) ?? null, [CARD_CLIENTS, cardId])
  useEffect(() => { if (listedCard) setLastKnownCard(listedCard) }, [listedCard])
  // Left the lists: read it from the whole base (shared with the «База клиентов» tab's cache).
  const cardNeedsBase = tab === 'card' && cardId != null && !listedCard && !deletedIds.has(cardId)
  const { data: baseData } = useCrmClients(undefined, { enabled: cardNeedsBase })
  const cardPick = useMemo(() => {
    const base = cardNeedsBase && baseData ? baseData.clients : null
    const avg = base ? portfolioAverageCheck(base) : 0
    return pickCardClient<PulseClient, CrmClient>({
      selectedId: cardId,
      lists: CARD_CLIENTS,
      lastKnown: lastKnownCard,
      base,
      deletedIds,
      // not in the first 50 of the queue: its bucket is not known here — none is shown
      fromBaseRow: (row) => withSector({ ...toTodayClient(row, avg, null, Date.now()), status: row.status }),
    })
  }, [cardNeedsBase, baseData, cardId, CARD_CLIENTS, lastKnownCard, deletedIds])
  const selectedClient = cardPick.kind === 'client' ? cardPick.client : null
  const cardChips = selectedClient && !listedCard ? [selectedClient, ...CARD_CLIENTS] : CARD_CLIENTS

  const filteredToday = TODAY_CLIENTS.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  )
  const filteredRisk = RISK_CLIENTS
    .filter((c) => filterRisk === 'all' || c.churnLevel === filterRisk)

  // KPI straight from the API (portfolio-wide, every client). No stand-ins: unknown stays unknown.
  const stats = clientsData?.stats ?? null

  // Manual briefing (POST /api/pulse/briefing over the own base): text, «нет клиентов»,
  // «лимит/бюджет исчерпан» or an error — and never a spinner that does not stop.
  const refreshBriefing = useCallback(async () => {
    setBriefingLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), BRIEFING_TIMEOUT_MS)
    try {
      const res = await fetch('/api/pulse/briefing', { method: 'POST', signal: ctrl.signal })
      let body: unknown = null
      try { body = await res.json() } catch { /* non-JSON (e.g. a proxy 504) */ }
      setBriefing(briefingView(res.status, body))
    } catch {
      setBriefing(briefingNetworkError(ctrl.signal.aborted))
    } finally {
      clearTimeout(timer)
      setBriefingLoading(false)
    }
  }, [])

  const highRisk = stats?.highRisk ?? 0
  const riskTotal = clientsData?.riskClientsTotal ?? 0
  // The whole queue's size; the payload carries its first 50 (lib/crm/today.ts TODAY_LIST_MAX).
  const todayTotal = clientsData?.todayClientsTotal ?? TODAY_CLIENTS.length

  return (
    <div className="space-y-6">
      {/* ── Modals & overlays ── */}
      <CallModal    client={callClient}    onClose={() => setCallClient(null)} />
      <MessageModal client={messageClient} onClose={() => setMessageClient(null)} />
      <ClientDrawer
        client={drawerClient}
        onClose={() => setDrawerClient(null)}
        onDeleted={(id) => setDeletedIds((prev) => new Set(prev).add(id))}
      />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* ── Header ── */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-4">
        <div className="flex-1">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            CRM · Монитор клиентской базы
          </p>
          <h1 className="font-headline text-2xl md:text-3xl lg:text-4xl font-extrabold text-on-surface">
            Кому звонить{' '}
            <span className="text-gradient">сегодня</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
            Очередь на сегодня из вашей базы: просроченные и запланированные контакты, клиенты без плана и
            «спящие». Кого обработали сегодня — уходит из очереди.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-primary/50">database</span>
              <span className="text-xs font-mono text-on-surface-variant">Данные из вашей базы клиентов</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Daily Briefing ── */}
      <section className="bg-gradient-to-r from-primary/[0.06] to-transparent rounded-2xl border border-primary/20 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-lg text-primary">tips_and_updates</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-mono text-primary uppercase tracking-[0.15em]">Рекомендация на сегодня</p>
              <button
                onClick={refreshBriefing}
                disabled={briefingLoading}
                className="flex items-center gap-1 text-[10px] font-mono text-primary/60 hover:text-primary transition-colors disabled:opacity-40"
              >
                <span className={`material-symbols-outlined text-sm ${briefingLoading ? 'animate-spin' : ''}`}>
                  {briefingLoading ? 'progress_activity' : 'refresh'}
                </span>
                {briefingLoading ? 'Генерация...' : 'Обновить'}
              </button>
            </div>
            {briefing?.status === 'ok' && briefing.text ? (
              <>
                {/* Plain text nodes only: **bold** from the model becomes <strong>, nothing is HTML. */}
                <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">
                  {briefingSegments(briefing.text).map((seg, i) =>
                    seg.bold ? <strong key={i} className="font-semibold">{seg.text}</strong> : <span key={i}>{seg.text}</span>)}
                </p>
                {briefing.cached && (
                  <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1.5">Рекомендация на сегодня уже готова — обновляется раз в день</p>
                )}
              </>
            ) : briefing ? (
              <p className={`text-sm ${briefing.status === 'error' ? 'text-error' : briefing.status === 'limited' ? 'text-tertiary-container' : 'text-on-surface-variant'}`}>
                {briefing.message}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant italic">
                Нажмите «Обновить», чтобы получить рекомендацию по вашей очереди
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      {todayReady && stats ? (
        <div data-tour="crm-kpi" className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            {
              label: 'Под угрозой (ср. чеки)',
              value: stats.revenueAtRisk == null ? 'нет данных' : fmt(stats.revenueAtRisk),
              icon: 'payments',
              color: stats.revenueAtRisk == null ? 'on-surface-variant' : 'error',
              sub: stats.revenueAtRisk == null
                ? `чек не указан у ${stats.highRiskWithoutCheck} из ${stats.highRisk} клиентов высокого риска`
                : `сумма средних чеков ${stats.highRisk} ${plural(stats.highRisk, 'клиента', 'клиентов', 'клиентов')} высокого риска`,
            },
            {
              label: 'Высокий риск',
              value: String(stats.highRisk),
              icon: 'crisis_alert',
              color: 'error',
              sub: 'звонок в приоритете',
            },
            {
              label: 'Средний риск',
              value: String(stats.mediumRisk),
              icon: 'warning',
              color: 'tertiary-container',
              sub: 'стоит написать',
            },
            {
              label: 'Всего клиентов',
              value: String(stats.totalClients),
              icon: 'group',
              color: 'on-surface-variant',
              sub: 'в вашей базе',
            },
            {
              label: 'Обработано сегодня',
              value: String(stats.processedToday),
              icon: 'task_alt',
              color: 'primary',
              sub: `в очереди осталось ${todayTotal}`,
            },
          ].map((stat) => (
            <div key={stat.label}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest leading-tight">{stat.label}</p>
                <span className={`material-symbols-outlined text-base text-${stat.color} opacity-60`}>{stat.icon}</span>
              </div>
              <p className={`text-xl font-mono font-bold text-${stat.color} leading-none mb-1`}>{stat.value}</p>
              <p className="text-[10px] text-on-surface-variant/60">{stat.sub}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Tabs (always: the base and the integrations do not depend on the queue) ── */}
      <div data-tour="crm-tabs" className="border-b border-white/[0.04] w-full overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {([
            { key: 'today', label: 'Кому звонить', labelFull: 'Кому звонить сегодня', count: todayReady ? todayTotal : null, icon: null },
            { key: 'base',  label: 'База',          labelFull: 'База клиентов',           count: todayReady ? stats?.totalClients ?? null : null, icon: 'contacts' },
            { key: 'risk',  label: 'В зоне риска', labelFull: 'Топ в зоне риска',       count: todayReady ? riskTotal : null, icon: null },
            { key: 'card',  label: 'Карточка',     labelFull: 'Карточка клиента',        count: null, icon: null },
            { key: 'crm',   label: 'CRM',          labelFull: 'CRM-интеграции',          count: null, icon: 'sync' },
          ] as const).map(({ key, label, labelFull, count, icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                tab === key
                  ? 'text-primary border-primary'
                  : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/50'
              }`}>
              {icon && <span className={`material-symbols-outlined text-sm ${tab === key ? 'text-primary' : ''}`}>{icon}</span>}
              <span className="md:hidden">{label}</span>
              <span className="hidden md:inline">{labelFull}</span>
              {count !== null && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  tab === key ? 'bg-primary/20 text-primary' : 'bg-surface-container text-on-surface-variant'
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── The queue-dependent tabs: loading / failed (honestly) / content ── */}
      {(tab === 'today' || tab === 'risk' || tab === 'card') && isLoading && <TodayLoading />}
      {(tab === 'today' || tab === 'risk' || tab === 'card') && todayFailed && (
        <TodayFailed onRetry={() => { void refetch() }} retrying={isFetching} />
      )}

      {/* ── Risk filter (only for the risk-scored queues) ── */}
      {todayReady && (tab === 'today' || tab === 'risk') && (
        <div className="flex gap-2 items-center overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest flex-shrink-0">Риск:</span>
          {(['all', 'high', 'medium', 'low'] as const).map((r) => {
            const labels = { all: 'Все', high: 'Высокий', medium: 'Средний', low: 'Низкий' }
            const colors = {
              all:    filterRisk === 'all'    ? 'bg-primary text-on-primary border-primary'                           : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface',
              high:   filterRisk === 'high'   ? 'bg-error text-white border-error'                                    : 'border-white/[0.06] text-on-surface-variant hover:text-error hover:border-error/30',
              medium: filterRisk === 'medium' ? 'bg-tertiary-container text-on-surface border-tertiary-container'     : 'border-white/[0.06] text-on-surface-variant hover:text-tertiary-container hover:border-tertiary-container/30',
              low:    filterRisk === 'low'    ? 'bg-primary/80 text-on-primary border-primary/80'                     : 'border-white/[0.06] text-on-surface-variant hover:text-primary hover:border-primary/30',
            }
            return (
              <button key={r} onClick={() => setFilterRisk(r)}
                className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full border transition-all duration-150 ${colors[r]}`}>
                {labels[r]}
              </button>
            )
          })}
        </div>
      )}

      {/* ─── TAB 1: Today ─── */}
      {tab === 'today' && todayReady && stats && (
        <div data-tour="crm-queue" className="space-y-4">
          {/* Alert banner — only what the base says */}
          {highRisk > 0 && (
            <div className="flex items-center gap-3 bg-error/10 border border-error/20 rounded-xl px-5 py-3.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse flex-shrink-0" />
              <p className="text-sm text-error font-medium">
                <strong>{highRisk} {plural(highRisk, 'клиент', 'клиента', 'клиентов')}</strong> в зоне высокого риска — давно без касаний
                или со статусом «Потерян».
                {stats.revenueAtRisk != null && stats.revenueAtRisk > 0 && (
                  <> Сумма их средних чеков — <strong>{fmt(stats.revenueAtRisk)}</strong>.</>
                )}
                {stats.revenueAtRisk == null && (
                  <> Сумма под угрозой неизвестна: у {stats.highRiskWithoutCheck} из них не указан средний чек.</>
                )}
              </p>
            </div>
          )}

          {/* Queue composition */}
          <p className="text-[11px] font-mono text-on-surface-variant">
            Просрочено: {stats.queue.overdue} · На сегодня: {stats.queue.today} · Без плана: {stats.queue.noPlan} · Спящих: {stats.queue.sleeping}
          </p>
          {todayTotal > TODAY_CLIENTS.length && (
            <p className="text-[11px] font-mono text-on-surface-variant">
              Показаны первые {TODAY_CLIENTS.length} из {todayTotal} по приоритету — остальные в очереди следом и на вкладке «База клиентов».
            </p>
          )}

          {TODAY_CLIENTS.length === 0 && (
            <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-white/[0.04]">
              <span className="material-symbols-outlined text-3xl text-primary/60 block mb-2">task_alt</span>
              <p className="text-sm text-on-surface-variant">
                {stats.totalClients === 0
                  ? 'В базе пока нет клиентов — добавьте их на вкладке «База клиентов».'
                  : 'Очередь на сегодня пуста: все клиенты обработаны или их контакт запланирован на другой день.'}
              </p>
            </div>
          )}

          {/* Mobile client cards (< md) */}
          <div className="md:hidden space-y-3">
            {filteredToday.map((c) => (
              <div key={c.id}
                onClick={() => { setSelectedClientId(c.id); setTab('card') }}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors">
                {/* Top row: name + action */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
                      c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                      <p className="text-[10px] text-on-surface-variant truncate">
                        {c.sector}{c.queueBucket != null ? ` · ${BUCKET_LABEL[c.queueBucket]}` : ''}
                      </p>
                    </div>
                  </div>
                  <ActionBtn action={c.action} size="sm"
                    onClick={() => runAction(c)} />
                </div>
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Ср. чек</p>
                    <p className="text-xs font-mono font-bold text-on-surface">{fmtCheck(c.avgCheck)}</p>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Чек к ср.</p>
                    <span className="text-xs font-mono font-bold text-on-surface">{fmtCheckVsAvg(c.checkVsAvgPct)}</span>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Касание</p>
                    <p className="text-xs font-mono text-on-surface">{fmtDaysSince(c.daysSince)}</p>
                  </div>
                </div>
                {/* Risk row */}
                <div className="flex items-center justify-between gap-3">
                  <RiskBar score={c.riskScore} />
                  <RiskBadge level={c.churnLevel} />
                </div>
                {/* Comment */}
                {c.comment && <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-2">{c.comment}</p>}
              </div>
            ))}
          </div>

          {/* Desktop table (≥ md) */}
          {TODAY_CLIENTS.length > 0 && (
          <div className="hidden md:block bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    {([
                      { label: 'Клиент', tip: 'Имя клиента, его статус и почему он в очереди сегодня' },
                      { label: 'Последнее касание', tip: 'Последний звонок, сообщение или встреча либо напоминание, отмеченное «Выполнено». Заметка касанием не считается' },
                      { label: 'Ср. чек', tip: 'Средний чек из карточки клиента; «—» — не указан' },
                      { label: 'Чек к среднему', tip: 'Чек клиента против среднего чека вашей базы: (чек − средний) ÷ средний × 100%. Это не динамика заказов' },
                      { label: 'Риск-скор', tip: 'Оценка 0–100 по правилу: дни без касания × 2,5 (до 70; нет касаний — 50), «Спящий» +15, «Клиент» −10, чек ниже половины среднего +10, чек выше двух средних −5 (средний — если известно хотя бы 2 чека), «Потерян» — 95' },
                      { label: 'Уровень риска', tip: 'Высокий — скор выше 60, средний — 41–60, низкий — до 40. Это уровень эвристики, а не вероятность' },
                      { label: 'Комментарий', tip: 'Подсказка из данных: нет касаний N дней, давно без движения, крупный чек' },
                      { label: 'Действие', tip: 'Звонок — статус «Потерян», нет касаний, больше 7 дней без касания или риск выше 60; Написать — риск выше 35; иначе мониторинг' },
                    ] as const).map((h) => (
                      <th key={h.label} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {h.label}
                          <span className="relative group/tip inline-flex">
                            <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40 hover:text-primary/70 transition-colors cursor-help">info</span>
                            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-[#1a1d27] border border-white/10 rounded-xl text-[11px] text-on-surface font-normal normal-case tracking-normal leading-relaxed w-56 opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-200 z-50 shadow-xl">
                              {h.tip}
                            </span>
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredToday.map((c) => (
                    <tr key={c.id}
                      onClick={() => { setSelectedClientId(c.id); setTab('card') }}
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                          }`} />
                          <div>
                            <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                            <p className="text-[10px] text-on-surface-variant">
                              {c.sector}{c.queueBucket != null ? ` · ${BUCKET_LABEL[c.queueBucket]}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-on-surface">{fmtDate(c.lastContactAt) ?? '—'}</p>
                        <p className="text-[10px] font-mono text-on-surface-variant">{fmtDaysSince(c.daysSince)}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-mono text-on-surface">{fmtCheck(c.avgCheck)}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-mono text-on-surface-variant">{fmtCheckVsAvg(c.checkVsAvgPct)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBar score={c.riskScore} />
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge level={c.churnLevel} />
                      </td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <p className="text-xs text-on-surface-variant truncate">{c.comment ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <ActionBtn action={c.action} size="sm"
                    onClick={() => runAction(c)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {/* Progress summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Приоритет 1 — Звонок', count: TODAY_CLIENTS.filter(c => c.action === 'call').length,    color: 'error',               icon: 'call'       },
              { label: 'Приоритет 2 — Написать', count: TODAY_CLIENTS.filter(c => c.action === 'message').length, color: 'tertiary-container',  icon: 'chat'       },
              { label: 'Мониторинг',             count: TODAY_CLIENTS.filter(c => c.action === 'monitor').length, color: 'primary',             icon: 'visibility' },
            ].map((item) => (
              <div key={item.label} className={`bg-surface-container-low rounded-xl border border-${item.color}/20 p-4 flex items-center gap-3`}>
                <div className={`w-8 h-8 rounded-lg bg-${item.color}/10 flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined text-sm text-${item.color}`}>{item.icon}</span>
                </div>
                <div>
                  <p className={`text-2xl font-mono font-bold text-${item.color}`}>{item.count}</p>
                  <p className="text-[10px] text-on-surface-variant">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── TAB: Client base (works without the queue) ─── */}
      {tab === 'base' && (
        <ClientsTable
          onOpenClient={(c) => setDrawerClient(crmToDrawer(c))}
          onOpenImport={() => setImportOpen(true)}
        />
      )}

      {/* ─── TAB 2: At Risk (the whole base, not only today's queue) ─── */}
      {tab === 'risk' && todayReady && (
        <div className="space-y-3">
          {riskTotal > RISK_CLIENTS.length && (
            <p className="text-[11px] font-mono text-on-surface-variant">
              Показаны {RISK_CLIENTS.length} самых рискованных из {riskTotal}
            </p>
          )}
          {RISK_CLIENTS.length === 0 && (
            <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-white/[0.04]">
              <p className="text-sm text-on-surface-variant">Клиентов со средним или высоким риском нет</p>
            </div>
          )}
          {filteredRisk.map((c, i) => (
            <div key={c.id}
              onClick={() => { setSelectedClientId(c.id); setTab('card') }}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors group">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-[10px] font-mono text-on-surface-variant/50 w-5 flex-shrink-0`}>#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                    <span className="text-[10px] text-on-surface-variant">{c.sector}</span>
                  </div>
                  <p className="text-xs text-on-surface-variant truncate">{c.comment ?? fmtDaysSince(c.daysSince)}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-on-surface-variant">Ср. чек</p>
                    <p className="text-sm font-mono font-bold text-on-surface">{fmtCheck(c.avgCheck)}</p>
                  </div>
                  <div className="w-20 sm:w-24">
                    <RiskBar score={c.riskScore} />
                  </div>
                  <RiskBadge level={c.churnLevel} />
                  <ActionBtn action={c.action} size="sm"
                    onClick={() => runAction(c)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TAB 3: Client Card ─── */}
      {tab === 'card' && todayReady && (
        <div className="space-y-4">
          {cardPick.kind === 'none' && (
            <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-white/[0.04]">
              <p className="text-sm text-on-surface-variant">
                В очереди и в зоне риска сейчас никого — карточку любого клиента можно открыть на вкладке «База клиентов».
              </p>
            </div>
          )}
          {/* Client selector */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {cardChips.map((c) => (
              <button key={c.id}
                onClick={() => setSelectedClientId(c.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors whitespace-nowrap flex-shrink-0 ${
                  selectedClient?.id === c.id
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-white/[0.06] text-on-surface-variant hover:border-white/[0.12] hover:text-on-surface'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                }`} />
                {c.name}
              </button>
            ))}
          </div>

          {cardPick.kind === 'deleted' && (
            <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-white/[0.04]">
              <p className="text-sm text-on-surface-variant">
                Этот клиент удалён из базы. Выберите другого клиента выше или на вкладке «База клиентов».
              </p>
            </div>
          )}
          {cardPick.kind === 'loading' && (
            <p className="text-xs text-on-surface-variant/60">Загрузка карточки…</p>
          )}
          {selectedClient && !listedCard && (
            <p className="text-[11px] font-mono text-on-surface-variant">
              {cardPick.kind === 'client' && cardPick.fromBase
                ? 'Клиента нет в показанных списках «Кому звонить» и «В зоне риска» — карточка по данным базы клиентов.'
                : 'Клиента нет в показанных списках «Кому звонить» и «В зоне риска» — обновляем карточку по базе клиентов…'}
            </p>
          )}
          {selectedClient && (
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 md:p-6">
              <ClientCard
                client={selectedClient}
                onCall={() => setCallClient(selectedClient)}
                onMessage={() => setMessageClient(selectedClient)}
                onMonitor={() => toggleMonitor(selectedClient.id)}
                onHistory={() => setDrawerClient(pulseToDrawer(selectedClient))}
                isMonitored={monitored.has(selectedClient.id)}
              />
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 4: CRM Integration ─── */}
      {tab === 'crm' && <CrmIntegrationTab />}

    </div>
  )
}
