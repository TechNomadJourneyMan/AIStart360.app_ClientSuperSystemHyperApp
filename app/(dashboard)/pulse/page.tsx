'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { useCrmToday, useLogInteraction, type CrmClient } from '@/hooks/useCrm'
import { ClientsTable } from '@/components/crm/ClientsTable'
import { ClientDrawer, type DrawerClient } from '@/components/crm/ClientDrawer'
import { CsvImportDialog } from '@/components/crm/CsvImportDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PulseModal } from './PulseModal'
import type { ClientStatus } from '@/lib/crm/client-validate'
import type { CrmProvider, CrmStatus } from '@/lib/crm/types'

// Tailwind cannot see `text-${color}` in a template string — those classes were
// only surviving because the same literals happened to exist in other files.
// Explicit maps: one place, statically analysable.
const TONE_TEXT = {
  error: 'text-error',
  tertiary: 'text-tertiary-container',
  primary: 'text-primary',
  muted: 'text-on-surface-variant',
} as const
const TONE_BG = {
  error: 'bg-error/10',
  tertiary: 'bg-tertiary-container/10',
  primary: 'bg-primary/10',
  muted: 'bg-surface-container',
} as const
const TONE_BORDER = {
  error: 'border-error/20',
  tertiary: 'border-tertiary-container/20',
  primary: 'border-primary/20',
  muted: 'border-white/[0.06]',
} as const
type Tone = keyof typeof TONE_TEXT

// Message templates used to sit inline in the JSX — data in markup.
const MESSAGE_TEMPLATES = [
  'Здравствуйте! Хотели уточнить статус нашего сотрудничества и обсудить следующие шаги.',
  'Добрый день! Заметили изменение в активности и хотели предложить встречу для обсуждения программы.',
  'Привет! Подготовили для вас обновлённое предложение — когда удобно обсудить?',
] as const

// «Мониторинг» used to live in a bare useState<Set> — switching a tab wiped it.
// It is a personal bookmark, so it is kept per browser and the UI says so.
const MONITOR_KEY = 'pulse:monitored'

// ─── Adapters → the drawer's minimal client seed ─────────────────────────────
function crmToDrawer(c: CrmClient): DrawerClient {
  return {
    id: c.id, name: c.name, phone: c.phone, phone_raw: c.phone_raw,
    email: c.email, status: c.status, avg_check: c.avg_check, note: c.note,
    next_contact_at: c.next_contact_at, last_contact_at: c.last_contact_at,
  }
}
function pulseToDrawer(c: PulseClient): DrawerClient {
  return {
    id: c.id, name: c.name, phone: c.phone ?? null, phone_raw: null,
    email: c.email ?? null, status: (c.status as ClientStatus) ?? 'new',
    avg_check: typeof c.avgCheck === 'number' ? c.avgCheck : null,
    note: c.note ?? null, next_contact_at: c.nextContactAt ?? null,
    last_contact_at: c.lastContactAt ?? null,
  }
}

// recharts lives inside GriPulseWidget — load it lazily so it stays out of this
// (already large) pulse page's first-load JS.
const GriPulseWidget = dynamic(() => import('@/components/pulse/GriPulseWidget'), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-surface-container-low rounded-2xl" />,
})

// ─── Action Modals ─────────────────────────────────────────────────────────────
// `statusLabel` used to be called `sector` and was rendered as the industry —
// but /api/v1/crm/today puts STATUS_LABELS[c.status] in it, so the card showed
// «Спящий» where the user expected an industry. Renamed to what it is.
type ModalClient = { id: string; name: string; statusLabel: string; phone?: string | null }

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
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
      },
    )
  }
  return (
    <PulseModal
      open
      onClose={onClose}
      icon="call"
      iconClass="bg-error/10 text-error"
      title={client.name}
      subtitle={client.statusLabel}
    >
      <div className="space-y-4">
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
    </PulseModal>
  )
}

function MessageModal({ client, onClose }: { client: ModalClient | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const logInteraction = useLogInteraction()
  useEffect(() => { setSent(false); setText('') }, [client?.id])
  if (!client) return null
  const digits = (client.phone ?? '').replace(/\D/g, '')

  const send = () => {
    // Open WhatsApp with the drafted text pre-filled where we have a number.
    if (digits) {
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank')
    }
    logInteraction.mutate(
      { clientId: client.id, kind: 'message', comment: text.trim() || undefined },
      {
        onSuccess: () => { setSent(true); toast.success('Сообщение зафиксировано') },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Ошибка'),
      },
    )
  }
  return (
    <PulseModal
      open
      onClose={onClose}
      icon="chat"
      iconClass="bg-tertiary-container/10 text-tertiary-container"
      title={client.name}
      subtitle={client.statusLabel}
    >
      <div className="space-y-3">
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
              {MESSAGE_TEMPLATES.map((t, i) => (
                <button key={i} type="button" onClick={() => setText(t)}
                  className="w-full text-left text-xs text-on-surface-variant bg-surface-container hover:bg-surface-container-high border border-white/[0.04] rounded-xl px-3 py-2 transition-colors line-clamp-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              aria-label="Текст сообщения"
              placeholder="Или напишите своё сообщение..."
              rows={3}
              className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 resize-none"
            />
            {!digits && (
              <p className="text-[11px] text-on-surface-variant/70">
                Телефона нет — WhatsApp не откроется, будет записано только касание.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:bg-white/[0.04] transition-colors">
                Отмена
              </button>
              <button type="button" onClick={send} disabled={!text.trim() || logInteraction.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-tertiary-container/10 border border-tertiary-container/20 text-sm text-tertiary-container font-medium hover:bg-tertiary-container/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <span className="material-symbols-outlined text-sm align-middle mr-1">send</span>
                {digits ? 'Открыть WhatsApp' : 'Зафиксировать'}
              </button>
            </div>
          </>
        )}
      </div>
    </PulseModal>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}Млрд ₸`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}М ₸`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}К ₸`
  return `${n} ₸`
}

function RiskBadge({ level, prob }: { level: 'high' | 'medium' | 'low'; prob: number }) {
  const cfg = {
    high:   { bg: 'bg-error/10 border-error/30 text-error',         dot: 'bg-error',         label: 'Высокий' },
    medium: { bg: 'bg-tertiary-container/10 border-tertiary-container/30 text-tertiary-container', dot: 'bg-tertiary-container', label: 'Средний' },
    low:    { bg: 'bg-primary/10 border-primary/30 text-primary',   dot: 'bg-primary',        label: 'Низкий'  },
  }[level]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono font-medium ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label} · {prob}%
    </span>
  )
}

// ActionBtn — the real action for a queue row. `clientName` is required so a
// screen reader hears «Позвонить HONOR GROUP» and not «Позвонить» × N.
function ActionBtn({ action, clientName, size = 'md', onClick }: {
  action: 'call' | 'message' | 'monitor'
  clientName: string
  size?: 'sm' | 'md'
  onClick?: () => void
}) {
  const cfg = {
    call:    { bg: 'bg-error/10 hover:bg-error/20 text-error border-error/20',             icon: 'call',          label: 'Позвонить'    },
    message: { bg: 'bg-tertiary-container/10 hover:bg-tertiary-container/20 text-tertiary-container border-tertiary-container/20', icon: 'chat',          label: 'Написать'     },
    monitor: { bg: 'bg-primary/10 hover:bg-primary/20 text-primary border-primary/20',     icon: 'visibility',    label: 'Мониторинг'   },
  }[action]
  const px = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5'
  return (
    <button
      type="button"
      aria-label={`${cfg.label} — ${clientName}`}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className={`relative z-10 inline-flex items-center gap-1.5 ${px} rounded-lg border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${cfg.bg}`}>
      <span className="material-symbols-outlined text-sm" aria-hidden="true">{cfg.icon}</span>
      {cfg.label}
    </button>
  )
}

// MiniSparkline is gone on purpose. It was fed `risk.history` — a synthetic
// ramp [health*0.6 … health] derived from the CURRENT health (lib/crm/risk.ts),
// so every client got the same always-green, always-rising line. There is no
// stored order history to draw yet, so nothing is drawn.

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

type PulseClient = {
  id: string
  name: string
  /** STATUS_LABELS[status] from /api/v1/crm/today — a status, never an industry. */
  statusLabel: string
  /** Formatted last_contact_at. `null` — клиента ещё ни разу не касались. */
  lastContact: string | null
  daysSince: number
  avgCheck: number
  volumeChange: number
  riskScore: number
  churnProb: number
  churnLevel: 'high' | 'medium' | 'low'
  comment: string | null
  action: 'call' | 'message' | 'monitor'
  orderCycle: number
  // Native CRM fields (from /api/v1/crm/today) — enable real tel:/wa.me actions,
  // status editing and the client drawer. Optional so the pulse-shaped type is happy.
  status?: string
  phone?: string | null
  email?: string | null
  note?: string | null
  nextContactAt?: string | null
  lastContactAt?: string | null
  queueBucket?: number
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
  const metrics: ReadonlyArray<{ label: string; value: string; icon: string; tone: Tone; hint: string }> = [
    { label: 'Средний чек', value: fmt(client.avgCheck), icon: 'payments', tone: 'primary',
      hint: 'Поле «Сумма» сделки в CRM' },
    { label: 'Изм. объёма', value: `${client.volumeChange > 0 ? '+' : ''}${client.volumeChange}%`, icon: 'trending_down',
      tone: client.volumeChange < 0 ? 'error' : 'primary',
      hint: 'Отклонение от среднего чека по портфелю' },
    { label: 'Риск-скор', value: String(client.riskScore), icon: 'warning',
      tone: client.riskScore >= 80 ? 'error' : 'tertiary',
      hint: 'Дни без касания × 2.5 (макс 70) + отклонение чека + статус' },
    { label: 'Дней без касания', value: String(client.daysSince), icon: 'schedule',
      tone: client.daysSince > client.orderCycle ? 'error' : 'primary',
      hint: `От last_contact_at. Ориентир цикла — ${client.orderCycle} дн.` },
  ]

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
            <RiskBadge level={client.churnLevel} prob={client.churnProb} />
          </div>
          <p className="text-sm text-on-surface-variant">
            Статус: {client.statusLabel} · Ориентир цикла {client.orderCycle} дней
          </p>
        </div>
        <ActionBtn action={client.action} clientName={client.name}
          onClick={client.action === 'call' ? onCall : client.action === 'message' ? onMessage : onMonitor} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="bg-surface-container rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`material-symbols-outlined text-sm ${TONE_TEXT[m.tone]}`} aria-hidden="true">{m.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{m.label}</p>
            </div>
            <p className={`text-lg font-mono font-bold ${TONE_TEXT[m.tone]}`}>{m.value}</p>
            <p className="text-[10px] text-on-surface-variant/60 mt-1 leading-snug">{m.hint}</p>
          </div>
        ))}
      </div>

      {/* Order history — honestly absent. The bar chart that used to live here
          drew risk.history: a synthetic ramp off the current health, with every
          bar labelled «0к» because health is 0..100 and the label divided by
          1000. Fake data removed rather than relabelled. */}
      <div className="bg-surface-container rounded-xl p-4">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">История заказов</p>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Истории заказов пока нет: в базе хранятся только касания (звонки, сообщения, заметки).
          График появится, когда подключённая CRM начнёт отдавать сделки.
        </p>
        <button
          type="button"
          onClick={onHistory}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">history</span>
          Показать историю касаний
        </button>
      </div>

      {/* Comment */}
      {client.comment && (
        <div className="bg-surface-container rounded-xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-sm text-on-surface-variant flex-shrink-0 mt-0.5" aria-hidden="true">comment</span>
          <p className="text-sm text-on-surface-variant">{client.comment}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <ActionBtn action="call" clientName={client.name} onClick={onCall} />
        <ActionBtn action="message" clientName={client.name} onClick={onMessage} />
        <button
          type="button"
          onClick={onMonitor}
          aria-pressed={!!isMonitored}
          aria-label={`Мониторинг — ${client.name}`}
          title="Личная отметка: хранится в этом браузере"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMonitored
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-white/[0.06] text-on-surface-variant hover:bg-white/[0.04]'
          }`}>
          <span className="material-symbols-outlined text-sm" aria-hidden="true">{isMonitored ? 'visibility' : 'visibility_off'}</span>
          {isMonitored ? 'Мониторинг вкл.' : 'Мониторинг'}
        </button>
        <button
          type="button"
          onClick={onHistory}
          aria-label={`История касаний — ${client.name}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.06] text-xs font-medium text-on-surface-variant hover:bg-white/[0.04] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">history</span>
          История
        </button>
        <span className="text-[10px] text-on-surface-variant/60">
          Отметка «Мониторинг» видна только вам, в этом браузере
        </span>
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
  // «Не удалось загрузить» used to be swallowed by an empty catch and rendered
  // as «интеграций нет» — two different facts shown as one.
  const [loadError, setLoadError] = useState(false)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)

  // Фаза 4B: живой бэкенд /api/v1/crm/connections (RLS own) вместо мёртвого
  // /api/crm (requireCrmOrg=null → 403). Маплем snake_case строки в CrmStatus,
  // чтобы не трогать разметку ниже.
  const fetchIntegrations = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch('/api/v1/crm/connections', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error('request failed')
      const rows = (json?.data ?? []) as Array<Record<string, unknown>>
      setIntegrations(
        rows.map((r) => ({
          id: String(r.id),
          provider: r.provider as CrmProvider,
          domain: String(r.base_url ?? ''),
          isActive: Boolean(r.is_active),
          lastSyncAt: (r.last_sync_at as string | null) ?? null,
          lastSyncStatus: (r.last_sync_status as string | null) ?? null,
          lastSyncError: (r.last_sync_error as string | null) ?? null,
          syncedDeals: Number(r.synced_deals ?? 0),
          syncedContacts: Number(r.synced_contacts ?? 0),
          createdAt: String(r.created_at ?? ''),
        })),
      )
    } catch {
      setIntegrations([])
      setLoadError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

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
      toast.success('CRM подключена')
      fetchIntegrations()
    } catch {
      setConnectError('Ошибка сети')
    }
    setConnectLoading(false)
  }

  const handleSync = async (id: string) => {
    setSyncingId(id)
    try {
      const res = await fetch(`/api/v1/crm/connections/${id}/sync`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        const { inserted = 0, updated = 0, skipped = 0 } = data.data ?? {}
        toast.success(`Синхронизировано: +${inserted}, обновлено ${updated}, пропущено ${skipped}`)
      } else {
        toast.error(data.error || 'Не удалось синхронизировать')
      }
      await fetchIntegrations()
    } catch {
      toast.error('Ошибка сети при синхронизации')
    }
    setSyncingId(null)
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
      tokenLabel: 'Webhook URL или OAuth Token',
      docs: 'https://dev.1c-bitrix.ru/rest_help/',
    },
    amocrm: {
      name: 'AmoCRM',
      icon: 'hub',
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10 border-cyan-400/20',
      gradient: 'from-cyan-500/20 to-cyan-600/5',
      domainHint: 'mycompany.amocrm.ru',
      tokenLabel: 'API ключ (Настройки → Интеграции)',
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
            Подключите Bitrix24 или AmoCRM для автоматической синхронизации сделок и контактов
          </p>
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
                    ? 'Синхронизация сделок, контактов и компаний. Поддержка вебхуков и OAuth.'
                    : 'Импорт лидов, сделок и контактов. API v4 с автообновлением.'}
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
                      {crm.lastSyncStatus === 'success' ? 'Успешно' :
                       crm.lastSyncStatus === 'partial' ? 'Частично' :
                       crm.lastSyncStatus === 'error' ? 'Ошибка' : '—'}
                    </p>
                    {crm.lastSyncError && (
                      <p className="text-[10px] text-error/70 mt-0.5 truncate max-w-[200px]" title={crm.lastSyncError}>{crm.lastSyncError}</p>
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
                  <p className="text-[10px] text-on-surface-variant/50 mt-1.5 pl-1">
                    Настройки → Разработчикам → Другое → Входящий вебхук
                  </p>
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
                      placeholder="Вставьте API ключ..."
                      className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 font-mono"
                    />
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

function CrmMonitorSection() {
  const [tab, setTab] = useState<'today' | 'base' | 'risk' | 'card' | 'crm'>('today')
  // Own CRM base (not the demo /api/pulse) — «Кому звонить сегодня» queue + KPI.
  const { data: clientsData, isLoading, error } = useCrmToday()
  const logInteraction = useLogInteraction()

  const [monitored, setMonitored]         = useState<Set<string>>(new Set())
  const [callClient, setCallClient]       = useState<ModalClient | null>(null)
  const [messageClient, setMessageClient] = useState<ModalClient | null>(null)
  const [filterRisk, setFilterRisk]       = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [briefing, setBriefing]           = useState<string | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [drawerClient, setDrawerClient]   = useState<DrawerClient | null>(null)
  const [importOpen, setImportOpen]       = useState(false)

  // Read after mount only — there is no localStorage during SSR, and seeding the
  // first render from it would hydrate a different tree than the server sent.
  const monitorLoaded = useRef(false)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MONITOR_KEY)
      const ids: unknown = raw ? JSON.parse(raw) : null
      if (Array.isArray(ids)) {
        setMonitored(new Set(ids.filter((v): v is string => typeof v === 'string')))
      }
    } catch { /* unreadable or corrupted storage — start with an empty set */ }
    monitorLoaded.current = true
  }, [])

  useEffect(() => {
    // Skip the pre-load render, otherwise the empty initial set overwrites what
    // is already stored before the effect above gets a chance to read it.
    if (!monitorLoaded.current) return
    try {
      window.localStorage.setItem(MONITOR_KEY, JSON.stringify([...monitored]))
    } catch { /* quota exceeded or storage blocked — the flag stays session-only */ }
  }, [monitored])

  const toggleMonitor = useCallback((id: string) => {
    setMonitored(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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
        onError: () => toast.error('Не удалось записать касание'),
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
        onError: () => toast.error('Не удалось записать касание'),
      },
    )
  }, [logInteraction])

  // Fire the right real action for a queue row (call → tel:, message → wa.me, monitor → toggle).
  const runAction = useCallback((c: PulseClient) => {
    if (c.action === 'call') doCall(c)
    else if (c.action === 'message') doMessage(c)
    else toggleMonitor(c.id)
  }, [doCall, doMessage, toggleMonitor])

  // Map the API row onto what this page actually renders. Two fields in the
  // /api/v1/crm/today contract are misnamed and are renamed here instead of
  // being mislabelled in the UI: `sector` holds STATUS_LABELS[status] and
  // `lastOrder` holds the formatted last_contact_at. Two more are dropped:
  // `forbes` is a hardcoded null and `history` a synthetic ramp off the current
  // health — neither is data, so neither is drawn.
  const TODAY_CLIENTS = useMemo<PulseClient[]>(() => {
    if (!clientsData?.todayClients) return []
    return clientsData.todayClients.map((m): PulseClient => ({
      id: m.id,
      name: m.name,
      statusLabel: m.sector,
      lastContact: m.lastOrder,
      daysSince: m.daysSince,
      avgCheck: m.avgCheck,
      volumeChange: m.volumeChange,
      riskScore: m.riskScore,
      churnProb: m.churnProb,
      churnLevel: m.churnLevel,
      comment: m.comment,
      action: m.action,
      orderCycle: m.orderCycle,
      // native CRM fields
      status: m.status,
      phone: m.phone,
      email: m.email,
      note: m.note,
      nextContactAt: m.nextContactAt,
      lastContactAt: m.lastContactAt,
      queueBucket: m.queueBucket,
    }))
  }, [clientsData])

  // Держим только ID выбранного клиента, а сам объект деривим из свежего
  // TODAY_CLIENTS — иначе после рефетча (напр. логирования касания) карточка
  // показывала бы устаревший снимок. Дефолт — первый в очереди.
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const selectedClient =
    TODAY_CLIENTS.find((c) => c.id === selectedClientId) ?? TODAY_CLIENTS[0] ?? null

  const filteredToday = TODAY_CLIENTS.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  )
  const filteredRisk = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high' || c.churnLevel === 'medium')
    .filter((c) => filterRisk === 'all' || c.churnLevel === filterRisk)
    .sort((a, b) => b.riskScore - a.riskScore)

  // KPI come from the API `stats` (portfolio-wide) — todayClients is only the
  // queue subset, so recomputing from it would undercount. Fall back to the
  // queue when a field is missing.
  const DYNAMIC_STATS = useMemo(() => {
    const s = clientsData?.stats
    const high = typeof s?.highRisk === 'number' ? s.highRisk : TODAY_CLIENTS.filter(c => c.churnLevel === 'high').length
    const medium = typeof s?.mediumRisk === 'number' ? s.mediumRisk : TODAY_CLIENTS.filter(c => c.churnLevel === 'medium').length
    const revenueAtRisk = typeof s?.revenueAtRisk === 'number'
      ? s.revenueAtRisk
      : TODAY_CLIENTS.filter(c => c.churnLevel === 'high').reduce((sum, c) => sum + c.avgCheck, 0)
    const totalClients = typeof s?.totalClients === 'number' ? s.totalClients : TODAY_CLIENTS.length
    const processedToday = typeof s?.processedToday === 'number' ? s.processedToday : 0
    const dailyTarget = typeof s?.dailyTarget === 'number' ? s.dailyTarget : Math.max(6, processedToday)
    return { revenueAtRisk, highRisk: high, mediumRisk: medium, totalClients, processedToday, dailyTarget }
  }, [TODAY_CLIENTS, clientsData])

  const highRiskRevenue = DYNAMIC_STATS.revenueAtRisk

  // Initialize briefing from API response (daily cached)
  useEffect(() => {
    if (clientsData?.aiBriefing && !briefing) {
      setBriefing(clientsData.aiBriefing)
    }
  }, [clientsData?.aiBriefing, briefing])

  // Manual refresh briefing
  const refreshBriefing = useCallback(async () => {
    setBriefingLoading(true)
    try {
      const res = await fetch('/api/pulse/briefing', { method: 'POST' })
      const data = await res.json()
      if (data.briefing) setBriefing(data.briefing)
    } catch { /* non-fatal */ }
    finally { setBriefingLoading(false) }
  }, [])

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )

  if (error) return (
    <div className="p-8 text-center bg-error/10 rounded-2xl border border-error/20">
      <p className="text-error font-medium">Ошибка загрузки данных</p>
      <p className="text-xs text-on-surface-variant mt-2">База данных временно недоступна или не настроена</p>
    </div>
  )

  if (!selectedClient && TODAY_CLIENTS.length > 0) return null

  return (
    <div className="space-y-6">
      {/* ── Modals & overlays ── */}
      <CallModal    client={callClient}    onClose={() => setCallClient(null)} />
      <MessageModal client={messageClient} onClose={() => setMessageClient(null)} />
      <ClientDrawer client={drawerClient} onClose={() => setDrawerClient(null)} />
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
            Инструмент менеджера по продажам — видит кто уходит, у кого падает объём, и какое действие нужно прямо сейчас.
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
            {briefing ? (
              <p className="text-sm text-on-surface leading-relaxed">{briefing}</p>
            ) : (
              <p className="text-sm text-on-surface-variant italic">
                Нажмите «Обновить» чтобы получить рекомендацию
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div data-tour="crm-kpi" className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([
          {
            label: 'Выручка под угрозой',
            value: fmt(highRiskRevenue),
            icon: 'payments',
            tone: 'error',
            sub: `${DYNAMIC_STATS.highRisk} клиентов высокого риска`,
          },
          {
            label: 'Высокий риск',
            value: String(DYNAMIC_STATS.highRisk),
            icon: 'crisis_alert',
            tone: 'error',
            sub: 'требуют звонка сегодня',
          },
          {
            label: 'Средний риск',
            value: String(DYNAMIC_STATS.mediumRisk),
            icon: 'warning',
            tone: 'tertiary',
            sub: 'написать до конца дня',
          },
          {
            label: 'Всего клиентов',
            value: String(DYNAMIC_STATS.totalClients),
            icon: 'group',
            tone: 'muted',
            sub: 'в активной базе',
          },
          {
            label: 'Обработано сегодня',
            value: `${DYNAMIC_STATS.processedToday} / ${DYNAMIC_STATS.dailyTarget}`,
            icon: 'task_alt',
            tone: 'primary',
            sub: `${Math.round((DYNAMIC_STATS.processedToday / DYNAMIC_STATS.dailyTarget) * 100)}% выполнено`,
          },
        ] as ReadonlyArray<{ label: string; value: string; icon: string; tone: Tone; sub: string }>).map((stat) => (
          <div key={stat.label}
            className="bg-surface-container-low rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest leading-tight">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${TONE_TEXT[stat.tone]} opacity-60`} aria-hidden="true">{stat.icon}</span>
            </div>
            <p className={`text-xl font-mono font-bold ${TONE_TEXT[stat.tone]} leading-none mb-1`}>{stat.value}</p>
            <p className="text-[10px] text-on-surface-variant/60">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div data-tour="crm-tabs" className="border-b border-white/[0.04] w-full overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {([
            { key: 'today', label: 'Кому звонить', labelFull: 'Кому продавать сегодня', count: TODAY_CLIENTS.length, icon: null },
            { key: 'base',  label: 'База',          labelFull: 'База клиентов',           count: DYNAMIC_STATS.totalClients, icon: 'contacts' },
            { key: 'risk',  label: 'В зоне риска', labelFull: 'Топ в зоне риска',       count: filteredRisk.length, icon: null },
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

      {/* ── Risk filter (only for the risk-scored queues) ── */}
      {(tab === 'today' || tab === 'risk') && (
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
      {tab === 'today' && (
        <div data-tour="crm-queue" className="space-y-4">
          {/* Alert banner */}
          {DYNAMIC_STATS.highRisk > 0 && (
            <div className="flex items-center gap-3 bg-error/10 border border-error/20 rounded-xl px-5 py-3.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse flex-shrink-0" />
              {/* Was: «просрочили цикл заказа более чем на 10 дней» и «возможна
                  потеря N в этом месяце». Ни того, ни другого код не считает:
                  highRisk — это churnLevel === 'high', а revenueAtRisk — сумма
                  средних чеков этих клиентов. Пишем то, что есть. */}
              <p className="text-sm text-error font-medium">
                Клиентов в высоком риске: <strong>{DYNAMIC_STATS.highRisk}</strong>.
                Их суммарный средний чек — <strong>{fmt(highRiskRevenue)}</strong>.
              </p>
            </div>
          )}

          {/* An empty queue used to render a bare table head and nothing else.
              Two different empties, named separately. */}
          {filteredToday.length === 0 && (
            TODAY_CLIENTS.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="Очередь на сегодня пуста"
                description="Ни у одного клиента нет просроченного напоминания, встречи на сегодня или долгого молчания. Очередь соберётся, как только в базе появятся клиенты."
                action={{ label: 'Импортировать базу из CSV', onClick: () => setImportOpen(true) }}
              />
            ) : (
              <EmptyState
                icon="filter_alt_off"
                title="Под фильтр никто не попал"
                description={`В очереди ${TODAY_CLIENTS.length} — ни один не подходит под выбранный уровень риска.`}
                action={{ label: 'Показать все', onClick: () => setFilterRisk('all') }}
              />
            )
          )}

          {/* Mobile client cards (< md) */}
          {filteredToday.length > 0 && (
          <div className="md:hidden space-y-3">
            {filteredToday.map((c) => (
              <div key={c.id}
                className="relative bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-4 transition-colors">
                {/* The card opens the client. A real button stretched across it —
                    the old `onClick` on the div was invisible to the keyboard.
                    ActionBtn sits above it (`relative z-10`) and stops the event. */}
                <button
                  type="button"
                  aria-label={`Открыть карточку — ${c.name}`}
                  onClick={() => { setSelectedClientId(c.id); setTab('card') }}
                  className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                />
                {/* Top row: name + action */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
                      c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                      <p className="text-[10px] text-on-surface-variant truncate">Статус: {c.statusLabel}</p>
                    </div>
                  </div>
                  <ActionBtn action={c.action} clientName={c.name} size="sm"
                    onClick={() => runAction(c)} />
                </div>
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Ср. чек</p>
                    <p className="text-xs font-mono font-bold text-on-surface">{fmt(c.avgCheck)}</p>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Изм. объёма</p>
                    <span className={`text-xs font-mono font-bold ${
                      c.volumeChange < -30 ? 'text-error' : c.volumeChange < 0 ? 'text-tertiary-container' : 'text-primary'
                    }`}>{c.volumeChange > 0 ? '+' : ''}{c.volumeChange}%</span>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Касание</p>
                    {c.lastContact ? (
                      <p className={`text-xs font-mono ${c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface'}`}>{c.daysSince} д. назад</p>
                    ) : (
                      <p className="text-xs font-mono text-error">не было</p>
                    )}
                  </div>
                </div>
                {/* Risk row */}
                <div className="flex items-center justify-between gap-3">
                  <RiskBar score={c.riskScore} />
                  <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                </div>
                {/* Comment */}
                {c.comment && (
                  <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-2">{c.comment}</p>
                )}
              </div>
            ))}
          </div>
          )}

          {/* Desktop table (≥ md) */}
          {filteredToday.length > 0 && (
          <div className="hidden md:block bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  {/* Tips describe what the code actually computes (lib/crm/risk.ts).
                      The previous set talked about deal stages and Bitrix24 fields
                      that this scoring never looks at. */}
                  <tr className="border-b border-white/[0.04]">
                    {([
                      { label: 'Клиент', tip: 'Имя из вашей базы клиентов и его текущий статус' },
                      { label: 'Последнее касание', tip: 'Дата последнего звонка, сообщения или заметки (last_contact_at) и сколько дней прошло' },
                      { label: 'Ср. чек', tip: 'Поле «Средний чек» в карточке клиента' },
                      { label: 'Изм. объёма', tip: 'Отклонение среднего чека от среднего по портфелю: (чек − средний) ÷ средний × 100%' },
                      { label: 'Риск-скор', tip: 'Оценка 0–100: дни без касания × 2.5 (максимум 70) + отклонение чека + поправка на статус' },
                      { label: 'Вер-сть оттока', tip: 'Равна риск-скору: отдельной модели оттока пока нет, это та же оценка в процентах' },
                      { label: 'Комментарий', tip: 'Подсказка по правилу: нет касаний, нет контакта N дней, крупный клиент' },
                      { label: 'Действие', tip: 'Рекомендация: Звонок (простой > 7 дн или риск > 60), Написать (риск > 35), Мониторинг (низкий риск)' },
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
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        {/* A row can't be a button — the client name is one instead,
                            so the queue is walkable with Tab. */}
                        <button
                          type="button"
                          onClick={() => { setSelectedClientId(c.id); setTab('card') }}
                          aria-label={`Открыть карточку — ${c.name}`}
                          className="group flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded-lg">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                          }`} />
                          <span className="block">
                            <span className="block text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</span>
                            <span className="block text-[10px] text-on-surface-variant">Статус: {c.statusLabel}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3.5">
                        {c.lastContact ? (
                          <>
                            <p className="text-sm text-on-surface">{c.lastContact}</p>
                            <p className={`text-[10px] font-mono ${c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface-variant'}`}>
                              {c.daysSince} дн. назад
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-error">Касаний не было</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-mono text-on-surface">{fmt(c.avgCheck)}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-sm font-mono font-bold px-2.5 py-1 rounded-lg ${
                          c.volumeChange < -30 ? 'bg-error/10 text-error' :
                          c.volumeChange < 0   ? 'bg-tertiary-container/10 text-tertiary-container' :
                                                  'bg-primary/10 text-primary'
                        }`}>
                          {c.volumeChange > 0 ? '+' : ''}{c.volumeChange}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBar score={c.riskScore} />
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                      </td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        {c.comment
                          ? <p className="text-xs text-on-surface-variant truncate" title={c.comment}>{c.comment}</p>
                          : <p className="text-xs text-on-surface-variant/40" aria-label="Комментария нет">—</p>}
                      </td>
                      <td className="px-4 py-3.5">
                        <ActionBtn action={c.action} clientName={c.name} size="sm"
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
            {([
              { label: 'Приоритет 1 — Звонок',   count: TODAY_CLIENTS.filter(c => c.action === 'call').length,    tone: 'error',    icon: 'call'       },
              { label: 'Приоритет 2 — Написать', count: TODAY_CLIENTS.filter(c => c.action === 'message').length, tone: 'tertiary', icon: 'chat'       },
              { label: 'Мониторинг',             count: TODAY_CLIENTS.filter(c => c.action === 'monitor').length, tone: 'primary',  icon: 'visibility' },
            ] as ReadonlyArray<{ label: string; count: number; tone: Tone; icon: string }>).map((item) => (
              <div key={item.label} className={`bg-surface-container-low rounded-xl border ${TONE_BORDER[item.tone]} p-4 flex items-center gap-3`}>
                <div className={`w-8 h-8 rounded-lg ${TONE_BG[item.tone]} flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined text-sm ${TONE_TEXT[item.tone]}`} aria-hidden="true">{item.icon}</span>
                </div>
                <div>
                  <p className={`text-2xl font-mono font-bold ${TONE_TEXT[item.tone]}`}>{item.count}</p>
                  <p className="text-[10px] text-on-surface-variant">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── TAB: Client base ─── */}
      {tab === 'base' && (
        <ClientsTable
          onOpenClient={(c) => setDrawerClient(crmToDrawer(c))}
          onOpenImport={() => setImportOpen(true)}
        />
      )}

      {/* ─── TAB 2: At Risk ─── */}
      {tab === 'risk' && (
        <div className="space-y-3">
          {filteredRisk.length === 0 && (
            <EmptyState
              icon={TODAY_CLIENTS.length === 0 ? 'inbox' : 'shield'}
              title={TODAY_CLIENTS.length === 0 ? 'Нечего оценивать' : 'В зоне риска никого нет'}
              description={
                TODAY_CLIENTS.length === 0
                  ? 'Риск считается по клиентам из очереди «Кому звонить». Пока очередь пуста, считать нечего.'
                  : 'Ни один клиент из очереди не набрал высокий или средний уровень риска по выбранному фильтру.'
              }
              action={
                TODAY_CLIENTS.length === 0
                  ? { label: 'Импортировать базу из CSV', onClick: () => setImportOpen(true) }
                  : filterRisk === 'all'
                    ? undefined
                    : { label: 'Показать все', onClick: () => setFilterRisk('all') }
              }
            />
          )}
          {filteredRisk.map((c, i) => (
            <div key={c.id}
              className="relative bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/20 p-4 transition-colors">
              {/* Stretched button instead of `onClick` on the row wrapper — the
                  ActionBtn on the right keeps `relative z-10` and stops the click. */}
              <button
                type="button"
                aria-label={`Открыть карточку — ${c.name}`}
                onClick={() => { setSelectedClientId(c.id); setTab('card') }}
                className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-mono text-on-surface-variant/50 w-5 flex-shrink-0">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                    <span className="text-[10px] text-on-surface-variant">Статус: {c.statusLabel}</span>
                  </div>
                  {c.comment && <p className="text-xs text-on-surface-variant truncate">{c.comment}</p>}
                </div>
                <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-on-surface-variant">Ср. чек</p>
                    <p className="text-sm font-mono font-bold text-on-surface">{fmt(c.avgCheck)}</p>
                  </div>
                  <div className="w-20 sm:w-24">
                    <RiskBar score={c.riskScore} />
                  </div>
                  <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                  <ActionBtn action={c.action} clientName={c.name} size="sm"
                    onClick={() => runAction(c)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TAB 3: Client Card ─── */}
      {tab === 'card' && (
        <div className="space-y-4">
          {/* Client selector */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {TODAY_CLIENTS.map((c) => (
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

          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 md:p-6">
            {selectedClient ? (
              <ClientCard
                client={selectedClient}
                onCall={() => setCallClient(selectedClient)}
                onMessage={() => setMessageClient(selectedClient)}
                onMonitor={() => toggleMonitor(selectedClient.id)}
                onHistory={() => setDrawerClient(pulseToDrawer(selectedClient))}
                isMonitored={monitored.has(selectedClient.id)}
              />
            ) : (
              <EmptyState
                icon="person_search"
                title="Карточку некому показать"
                description="Карточка открывается из очереди «Кому звонить сегодня». Пока в очереди никого нет, выбирать не из чего."
                action={{ label: 'Импортировать базу из CSV', onClick: () => setImportOpen(true) }}
              />
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 4: CRM Integration ─── */}
      {tab === 'crm' && <CrmIntegrationTab />}

    </div>
  )
}
