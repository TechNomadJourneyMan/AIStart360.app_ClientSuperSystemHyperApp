'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePulse } from '@/hooks/usePulse'
import type { CrmProvider, CrmStatus } from '@/lib/crm/types'

// ─── Action Modals ─────────────────────────────────────────────────────────────
function CallModal({ client, onClose }: { client: { name: string; sector: string } | null; onClose: () => void }) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'done'>('idle')
  const [note, setNote] = useState('')
  if (!client) return null
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
              <p className="text-xs text-on-surface-variant mt-1">Действие записано в историю контактов</p>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                {['+7 701 000 00 01', '+7 727 300 55 00'].map(num => (
                  <a key={num} href={`tel:${num.replace(/\s/g,'')}`}
                    className="flex-1 flex items-center gap-2 bg-error/10 hover:bg-error/20 border border-error/20 text-error text-xs font-mono px-3 py-2.5 rounded-xl transition-colors">
                    <span className="material-symbols-outlined text-sm">phone_forwarded</span>
                    {num}
                  </a>
                ))}
              </div>
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
                  onClick={() => setStatus('done')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-error/10 border border-error/20 text-sm text-error font-medium hover:bg-error/20 transition-colors">
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

function MessageModal({ client, onClose }: { client: { name: string; sector: string } | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  if (!client) return null
  const templates = [
    `Здравствуйте! Хотели уточнить статус нашего сотрудничества и обсудить следующие шаги.`,
    `Добрый день! Заметили изменение в активности и хотели предложить встречу для обсуждения программы.`,
    `Привет! Подготовили для вас обновлённое предложение — когда удобно обсудить?`,
  ]
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
              <p className="text-sm font-medium text-on-surface">Сообщение отправлено</p>
              <p className="text-xs text-on-surface-variant mt-1">Ответ придёт на корпоративную почту</p>
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
                <button onClick={() => setSent(true)} disabled={!text.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-tertiary-container/10 border border-tertiary-container/20 text-sm text-tertiary-container font-medium hover:bg-tertiary-container/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">send</span>
                  Отправить
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

function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const w = 40, h = 20
  const pts = values.map((v: number, i: number) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const isUp = values[values.length - 1] >= values[0]
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={isUp ? '#4ade80' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
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

type PulseClient = {
  id: string
  name: string
  sector: string
  forbes?: number | null
  lastOrder: string
  daysSince: number
  avgCheck: number
  volumeChange: number
  riskScore: number
  churnProb: number
  churnLevel: 'high' | 'medium' | 'low'
  comment: string
  action: 'call' | 'message' | 'monitor'
  history: number[]
  orderCycle: number
}

// ─── Client Card Tab ──────────────────────────────────────────────────────────
function ClientCard({ client, onCall, onMessage, onMonitor, isMonitored }: {
  client: PulseClient
  onCall?: () => void
  onMessage?: () => void
  onMonitor?: () => void
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
            {'forbes' in client && (
              <span className="text-[10px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/30 px-2 py-0.5 rounded-full">
                🏆 Forbes KZ #{(client as any).forbes}
              </span>
            )}
            <RiskBadge level={client.churnLevel} prob={client.churnProb} />
          </div>
          <p className="text-sm text-on-surface-variant">
            {client.sector} · {('revenue' in client) ? `Выручка: ${(client as any).revenue}` : ''} · {('employees' in client) ? `${(client as any).employees} сотр.` : ''} · Цикл {client.orderCycle} дней
          </p>
        </div>
        <ActionBtn action={client.action}
          onClick={client.action === 'call' ? onCall : client.action === 'message' ? onMessage : onMonitor} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Средний чек', value: fmt(client.avgCheck), icon: 'payments',   color: 'primary' },
          { label: 'Изм. объёма', value: `${client.volumeChange > 0 ? '+' : ''}${client.volumeChange}%`, icon: 'trending_down', color: client.volumeChange < 0 ? 'error' : 'primary' },
          { label: 'Риск-скор',   value: String(client.riskScore), icon: 'warning', color: client.riskScore >= 80 ? 'error' : 'tertiary-container' },
          { label: 'Дней без заказа', value: String(client.daysSince), icon: 'schedule', color: client.daysSince > client.orderCycle ? 'error' : 'primary' },
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

      {/* Trend chart */}
      <div className="bg-surface-container rounded-xl p-4">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">История заказов (последние 5)</p>
        <div className="flex items-end gap-2 h-16">
          {client.history.map((val: number, i: number) => {
            const max = Math.max(...client.history)
            const pct = (val / max) * 100
            const isLast = i === client.history.length - 1
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-sm transition-all ${isLast ? 'bg-primary/60' : 'bg-surface-container-high'}`}
                  style={{ height: `${pct}%`, minHeight: 4 }}
                />
                <p className="text-[8px] font-mono text-on-surface-variant">{(val / 1000).toFixed(0)}к</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Comment */}
      <div className="bg-surface-container rounded-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-sm text-on-surface-variant flex-shrink-0 mt-0.5">comment</span>
        <p className="text-sm text-on-surface-variant">{client.comment}</p>
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
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.06] text-xs font-medium text-on-surface-variant hover:bg-white/[0.04] transition-colors">
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

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/crm')
      const data = await res.json()
      setIntegrations(data.integrations || [])
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

  const handleConnect = async () => {
    setConnectLoading(true)
    setConnectError(null)
    try {
      // For Bitrix24: extract domain from webhook URL, no separate token needed
      const payload = connectProvider === 'bitrix24'
        ? {
            provider: 'bitrix24',
            domain: connectWebhook.replace(/^https?:\/\//, '').split('/')[0],
            accessToken: connectWebhook,
            webhookUrl: connectWebhook,
          }
        : {
            provider: 'amocrm',
            domain: connectDomain,
            accessToken: connectToken,
          }

      const res = await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setConnectError(data.error || 'Ошибка подключения')
        setConnectLoading(false)
        return
      }
      setShowConnect(false)
      setConnectDomain('')
      setConnectToken('')
      setConnectWebhook('')
      fetchIntegrations()
    } catch {
      setConnectError('Ошибка сети')
    }
    setConnectLoading(false)
  }

  const handleSync = async (id: string) => {
    setSyncingId(id)
    try {
      await fetch('/api/crm/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await fetchIntegrations()
    } catch { /* empty */ }
    setSyncingId(null)
  }

  const handleDisconnect = async (id: string) => {
    if (!confirm('Отключить CRM-интеграцию?')) return
    try {
      await fetch('/api/crm', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
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
type ModalClient = { name: string; sector: string }

export default function PulsePage() {
  const [tab, setTab] = useState<'today' | 'risk' | 'card' | 'crm'>('today')
  const { data: clientsData, isLoading, error } = usePulse()
  
  const [monitored, setMonitored]         = useState<Set<string>>(new Set())
  const [callClient, setCallClient]       = useState<ModalClient | null>(null)
  const [messageClient, setMessageClient] = useState<ModalClient | null>(null)
  const [filterRisk, setFilterRisk]       = useState<'all' | 'high' | 'medium' | 'low'>('all')

  const toggleMonitor = (id: string) =>
    setMonitored(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // Map backend data to frontend structure
  const TODAY_CLIENTS = useMemo(() => {
    if (!clientsData?.todayClients) return []
    return (clientsData.todayClients as any[]).map(m => ({
      id: m.id,
      name: m.name,
      sector: m.sector,
      forbes: m.forbes,
      lastOrder: m.lastOrder,
      daysSince: m.daysSince,
      avgCheck: m.avgCheck,
      volumeChange: m.volumeChange,
      riskScore: m.riskScore,
      churnProb: m.churnProb,
      churnLevel: m.churnLevel as 'high' | 'medium' | 'low',
      comment: m.comment,
      action: m.action as 'call' | 'message' | 'monitor',
      history: m.history,
      orderCycle: m.orderCycle || 14,
    }))
  }, [clientsData])

  const [selectedClient, setSelectedClient] = useState<PulseClient | null>(null)

  // Initialize selected client once data is loaded
  useMemo(() => {
    if (TODAY_CLIENTS.length > 0 && !selectedClient) {
      setSelectedClient(TODAY_CLIENTS[0])
    }
  }, [TODAY_CLIENTS, selectedClient])

  const filteredToday = TODAY_CLIENTS.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  )
  const filteredRisk = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high' || c.churnLevel === 'medium')
    .filter((c) => filterRisk === 'all' || c.churnLevel === filterRisk)
    .sort((a, b) => b.riskScore - a.riskScore)

  const highRiskRevenue = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high')
    .reduce((s, c) => s + c.avgCheck, 0)

  // Dynamic Stats
  const DYNAMIC_STATS = useMemo(() => {
    const high = TODAY_CLIENTS.filter(c => c.churnLevel === 'high').length
    const medium = TODAY_CLIENTS.filter(c => c.churnLevel === 'medium').length
    const apiProcessedToday = typeof clientsData?.stats?.processedToday === 'number' ? clientsData.stats.processedToday : TODAY_CLIENTS.length
    const apiDailyTarget = typeof clientsData?.stats?.dailyTarget === 'number' ? clientsData.stats.dailyTarget : Math.max(6, apiProcessedToday)
    return {
      revenueAtRisk: highRiskRevenue,
      highRisk: high,
      mediumRisk: medium,
      totalClients: TODAY_CLIENTS.length,
      processedToday: apiProcessedToday,
      dailyTarget: apiDailyTarget,
    }
  }, [TODAY_CLIENTS, highRiskRevenue, clientsData])

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
      {/* ── Modals ── */}
      <CallModal    client={callClient}    onClose={() => setCallClient(null)} />
      <MessageModal client={messageClient} onClose={() => setMessageClient(null)} />

      {/* ── Header ── */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-4">
        <div className="flex-1">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            GRI Pulse · Монитор клиентской базы
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
              <span className="material-symbols-outlined text-sm text-tertiary-container">workspace_premium</span>
              <span className="text-xs font-mono text-tertiary-container">Forbes Kazakhstan Top 10 · демо-база клиентов</span>
            </div>
            <a href="https://in.aistart360.app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container border border-white/[0.06] hover:border-primary/30 rounded-lg text-xs font-mono text-primary transition-colors">
              <span className="material-symbols-outlined text-sm">open_in_new</span>
              in.aistart360.app
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          {
            label: 'Выручка под угрозой',
            value: fmt(highRiskRevenue),
            icon: 'payments',
            color: 'error',
            sub: `${DYNAMIC_STATS.highRisk} клиентов высокого риска`,
          },
          {
            label: 'Высокий риск',
            value: String(DYNAMIC_STATS.highRisk),
            icon: 'crisis_alert',
            color: 'error',
            sub: 'требуют звонка сегодня',
          },
          {
            label: 'Средний риск',
            value: String(DYNAMIC_STATS.mediumRisk),
            icon: 'warning',
            color: 'tertiary-container',
            sub: 'написать до конца дня',
          },
          {
            label: 'Всего клиентов',
            value: String(DYNAMIC_STATS.totalClients),
            icon: 'group',
            color: 'on-surface-variant',
            sub: 'в активной базе',
          },
          {
            label: 'Обработано сегодня',
            value: `${DYNAMIC_STATS.processedToday} / ${DYNAMIC_STATS.dailyTarget}`,
            icon: 'task_alt',
            color: 'primary',
            sub: `${Math.round((DYNAMIC_STATS.processedToday / DYNAMIC_STATS.dailyTarget) * 100)}% выполнено`,
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

      {/* ── Tabs ── */}
      <div className="border-b border-white/[0.04] w-full overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {([
            { key: 'today', label: 'Кому звонить', labelFull: 'Кому продавать сегодня', count: TODAY_CLIENTS.length, icon: null },
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

      {/* ── Risk filter ── */}
      {tab !== 'card' && (
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
        <div className="space-y-4">
          {/* Alert banner */}
          {DYNAMIC_STATS.highRisk > 0 && (
            <div className="flex items-center gap-3 bg-error/10 border border-error/20 rounded-xl px-5 py-3.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse flex-shrink-0" />
              <p className="text-sm text-error font-medium">
                <strong>{DYNAMIC_STATS.highRisk} клиента</strong> просрочили цикл заказа более чем на 10 дней.
                Возможна потеря <strong>{fmt(highRiskRevenue)}</strong> в этом месяце.
              </p>
            </div>
          )}

          {/* Mobile client cards (< md) */}
          <div className="md:hidden space-y-3">
            {filteredToday.map((c) => (
              <div key={c.id}
                onClick={() => { setSelectedClient(c); setTab('card') }}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors">
                {/* Top row: name + action */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
                      c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                    }`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                        {'forbes' in c && (
                          <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                            Forbes #{(c as any).forbes}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-on-surface-variant truncate">{c.sector}</p>
                    </div>
                  </div>
                  <ActionBtn action={c.action} size="sm"
                    onClick={() => c.action === 'call' ? setCallClient(c) : c.action === 'message' ? setMessageClient(c) : toggleMonitor(c.id)} />
                </div>
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Ср. чек</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-mono font-bold text-on-surface">{fmt(c.avgCheck)}</p>
                      <MiniSparkline values={c.history} />
                    </div>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Изм. объёма</p>
                    <span className={`text-xs font-mono font-bold ${
                      c.volumeChange < -30 ? 'text-error' : c.volumeChange < 0 ? 'text-tertiary-container' : 'text-primary'
                    }`}>{c.volumeChange > 0 ? '+' : ''}{c.volumeChange}%</span>
                  </div>
                  <div className="bg-surface-container rounded-lg p-2">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase mb-1">Заказ</p>
                    <p className={`text-xs font-mono ${c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface'}`}>{c.daysSince}д. назад</p>
                  </div>
                </div>
                {/* Risk row */}
                <div className="flex items-center justify-between gap-3">
                  <RiskBar score={c.riskScore} />
                  <RiskBadge level={c.churnLevel} prob={c.churnProb} />
                </div>
                {/* Comment */}
                <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-2">{c.comment}</p>
              </div>
            ))}
          </div>

          {/* Desktop table (≥ md) */}
          <div className="hidden md:block bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    {['Клиент', 'Последний заказ', 'Ср. чек', 'Изм. объёма', 'Риск-скор', 'Вер-сть оттока', 'Комментарий', 'Действие'].map((h) => (
                      <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredToday.map((c) => (
                    <tr key={c.id}
                      onClick={() => { setSelectedClient(c); setTab('card') }}
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            c.churnLevel === 'high' ? 'bg-error' : c.churnLevel === 'medium' ? 'bg-tertiary-container' : 'bg-primary'
                          }`} />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                              {'forbes' in c && (
                                <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                                  Forbes #{(c as any).forbes}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-on-surface-variant">{c.sector}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-on-surface">{c.lastOrder}</p>
                        <p className={`text-[10px] font-mono ${c.daysSince > c.orderCycle ? 'text-error' : 'text-on-surface-variant'}`}>
                          {c.daysSince} дн. назад
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-mono text-on-surface">{fmt(c.avgCheck)}</p>
                          <MiniSparkline values={c.history} />
                        </div>
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
                        <p className="text-xs text-on-surface-variant truncate">{c.comment}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <ActionBtn action={c.action} size="sm"
                    onClick={() => c.action === 'call' ? setCallClient(c) : c.action === 'message' ? setMessageClient(c) : toggleMonitor(c.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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

      {/* ─── TAB 2: At Risk ─── */}
      {tab === 'risk' && (
        <div className="space-y-3">
          {filteredRisk.map((c, i) => (
            <div key={c.id}
              onClick={() => { setSelectedClient(c); setTab('card') }}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/20 p-4 cursor-pointer transition-colors group">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-[10px] font-mono text-on-surface-variant/50 w-5 flex-shrink-0`}>#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">{c.name}</p>
                    {'forbes' in c && (
                      <span className="text-[9px] font-mono bg-tertiary-container/20 text-tertiary-container border border-tertiary-container/20 px-1.5 py-0.5 rounded-full">
                        Forbes #{(c as any).forbes}
                      </span>
                    )}
                    <span className="text-[10px] text-on-surface-variant">{c.sector}</span>
                  </div>
                  <p className="text-xs text-on-surface-variant truncate">{c.comment}</p>
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
                  <ActionBtn action={c.action} size="sm"
                    onClick={() => c.action === 'call' ? setCallClient(c) : c.action === 'message' ? setMessageClient(c) : toggleMonitor(c.id)} />
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
                onClick={() => setSelectedClient(c)}
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
            {selectedClient && (
              <ClientCard
                client={selectedClient}
                onCall={() => setCallClient(selectedClient)}
                onMessage={() => setMessageClient(selectedClient)}
                onMonitor={() => toggleMonitor(selectedClient.id)}
                isMonitored={monitored.has(selectedClient.id)}
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
