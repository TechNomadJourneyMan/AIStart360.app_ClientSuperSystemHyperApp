'use client'

import { useState } from 'react'
import Link from 'next/link'

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

// ─── Forbes Kazakhstan Top 10 companies as GRI Pulse clients ─────────────────
// Топ компаний Forbes KZ — реальные данные для демонстрации
const FORBES_BADGE = '🏆 Forbes KZ'

const TODAY_CLIENTS = [
  {
    id: '1', name: 'КазМунайГаз', sector: 'Нефть и газ', forbes: 1,
    lastOrder: '26 янв', daysSince: 28, avgCheck: 48_500_000,
    volumeChange: -42, riskScore: 94,
    churnProb: 87, churnLevel: 'high' as const,
    comment: 'Менеджер не выходил на связь 18 дней. Срочно требуется эскалация.',
    action: 'call' as const, orderCycle: 21,
    history: [48500, 46000, 42000, 37000, 28000],
    revenue: '₸18.2 трлн', employees: '38 000',
  },
  {
    id: '2', name: 'Kaspi.kz', sector: 'FinTech / E-commerce', forbes: 2,
    lastOrder: '15 янв', daysSince: 39, avgCheck: 32_000_000,
    volumeChange: -55, riskScore: 91,
    churnProb: 83, churnLevel: 'high' as const,
    comment: 'Не отвечает на запросы 3 недели. Конкурент предложил условия лучше.',
    action: 'call' as const, orderCycle: 18,
    history: [32000, 28500, 24000, 19000, 14400],
    revenue: '₸2.1 трлн', employees: '22 000',
  },
  {
    id: '3', name: 'Самрук-Казына', sector: 'Холдинг / Госфонд', forbes: 3,
    lastOrder: '10 фев', daysSince: 13, avgCheck: 28_000_000,
    volumeChange: -38, riskScore: 82,
    churnProb: 76, churnLevel: 'high' as const,
    comment: 'Паттерн покупки сломался — ранее сессии каждые 10 дней.',
    action: 'call' as const, orderCycle: 10,
    history: [28000, 26500, 25000, 21000, 17360],
    revenue: '₸24.8 трлн', employees: '280 000',
  },
  {
    id: '4', name: 'ERG (Eurasian Resources)', sector: 'Горнодобыча', forbes: 4,
    lastOrder: '18 фев', daysSince: 5, avgCheck: 22_000_000,
    volumeChange: -18, riskScore: 64,
    churnProb: 54, churnLevel: 'medium' as const,
    comment: 'Откладывает следующую сессию 2 недели. Возможно бюджетный стоп.',
    action: 'message' as const, orderCycle: 14,
    history: [22000, 21000, 20500, 19800, 18040],
    revenue: '₸6.5 трлн', employees: '75 000',
  },
  {
    id: '5', name: 'Halyk Bank', sector: 'Банкинг', forbes: 5,
    lastOrder: '22 фев', daysSince: 1, avgCheck: 14_500_000,
    volumeChange: -12, riskScore: 58,
    churnProb: 47, churnLevel: 'medium' as const,
    comment: 'Снизили частоту сессий. Запросили пересмотр договора.',
    action: 'message' as const, orderCycle: 30,
    history: [14500, 14200, 13900, 13500, 12760],
    revenue: '₸4.8 трлн', employees: '19 000',
  },
  {
    id: '6', name: 'Air Astana', sector: 'Авиация', forbes: 6,
    lastOrder: '5 мар', daysSince: 0, avgCheck: 9_800_000,
    volumeChange: +12, riskScore: 18,
    churnProb: 12, churnLevel: 'low' as const,
    comment: 'Активный клиент, растут. Запросили расширение программы.',
    action: 'monitor' as const, orderCycle: 7,
    history: [8200, 8600, 9000, 9400, 9800],
    revenue: '₸892 млрд', employees: '5 400',
  },
]

const AT_RISK_EXTENDED = [
  ...TODAY_CLIENTS.slice(0, 3),
  {
    id: '7', name: 'Freedom Finance', sector: 'Инвестиции / Финансы', forbes: 7,
    lastOrder: '28 янв', daysSince: 26, avgCheck: 11_500_000,
    volumeChange: -65, riskScore: 97,
    churnProb: 92, churnLevel: 'high' as const,
    comment: 'Критично! Ключевой спонсор ушёл. Срочно — звонок CEO.',
    action: 'call' as const, orderCycle: 14,
    history: [11500, 9800, 7800, 5600, 4025],
    revenue: '₸1.2 трлн', employees: '8 500',
  },
  {
    id: '8', name: 'Kcell', sector: 'Телеком', forbes: 8,
    lastOrder: '1 мар', daysSince: 4, avgCheck: 7_200_000,
    volumeChange: -28, riskScore: 75,
    churnProb: 67, churnLevel: 'medium' as const,
    comment: 'Сменился контактный директор. Нет подтверждения встречи.',
    action: 'call' as const, orderCycle: 21,
    history: [7200, 6900, 6400, 6000, 5184],
    revenue: '₸312 млрд', employees: '3 200',
  },
  {
    id: '9', name: 'RG Brands', sector: 'FMCG / Кондитерская', forbes: 9,
    lastOrder: '28 фев', daysSince: 5, avgCheck: 4_800_000,
    volumeChange: -8, riskScore: 45,
    churnProb: 38, churnLevel: 'medium' as const,
    comment: 'Запрашивают скидку. Пересматривают бюджет Q2.',
    action: 'message' as const, orderCycle: 30,
    history: [4800, 4700, 4600, 4500, 4416],
    revenue: '₸180 млрд', employees: '12 000',
  },
  {
    id: '10', name: 'Forte Bank', sector: 'Банкинг', forbes: 10,
    lastOrder: '4 мар', daysSince: 1, avgCheck: 3_600_000,
    volumeChange: +7, riskScore: 14,
    churnProb: 9, churnLevel: 'low' as const,
    comment: 'Отличная динамика. Продлили контракт на год вперёд.',
    action: 'monitor' as const, orderCycle: 14,
    history: [3200, 3300, 3400, 3500, 3600],
    revenue: '₸2.1 трлн', employees: '6 800',
  },
  ...TODAY_CLIENTS.slice(3, 6),
]

const STATS = {
  revenueAtRisk: 108_500_000,
  highRisk: 4,
  mediumRisk: 3,
  totalClients: 10,
  processedToday: 3,
  dailyTarget: 6,
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
  const pts = values.map((v, i) => {
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

// ─── Client Card Tab ──────────────────────────────────────────────────────────
function ClientCard({ client, onCall, onMessage, onMonitor, isMonitored }: {
  client: typeof TODAY_CLIENTS[0]
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
          {client.history.map((val, i) => {
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

// ─── Main component ───────────────────────────────────────────────────────────
type ModalClient = { name: string; sector: string }

export default function PulsePage() {
  const [tab, setTab] = useState<'today' | 'risk' | 'card'>('today')
  const [selectedClient, setSelectedClient] = useState(TODAY_CLIENTS[0])
  const [filterRisk, setFilterRisk] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [callClient, setCallClient]       = useState<ModalClient | null>(null)
  const [messageClient, setMessageClient] = useState<ModalClient | null>(null)
  const [monitored, setMonitored]         = useState<Set<string>>(new Set())

  const toggleMonitor = (id: string) =>
    setMonitored(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const filteredToday = TODAY_CLIENTS.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  )
  const filteredRisk = AT_RISK_EXTENDED.filter(
    (c) => filterRisk === 'all' || c.churnLevel === filterRisk
  ).sort((a, b) => b.riskScore - a.riskScore)

  const highRiskRevenue = TODAY_CLIENTS
    .filter((c) => c.churnLevel === 'high')
    .reduce((s, c) => s + c.avgCheck, 0)

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
            sub: `${STATS.highRisk} клиентов высокого риска`,
          },
          {
            label: 'Высокий риск',
            value: String(STATS.highRisk),
            icon: 'crisis_alert',
            color: 'error',
            sub: 'требуют звонка сегодня',
          },
          {
            label: 'Средний риск',
            value: String(STATS.mediumRisk),
            icon: 'warning',
            color: 'tertiary-container',
            sub: 'написать до конца дня',
          },
          {
            label: 'Всего клиентов',
            value: String(STATS.totalClients),
            icon: 'group',
            color: 'on-surface-variant',
            sub: 'в активной базе',
          },
          {
            label: 'Обработано сегодня',
            value: `${STATS.processedToday} / ${STATS.dailyTarget}`,
            icon: 'task_alt',
            color: 'primary',
            sub: `${Math.round((STATS.processedToday / STATS.dailyTarget) * 100)}% выполнено`,
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
            { key: 'today', label: 'Кому звонить', labelFull: 'Кому продавать сегодня', count: TODAY_CLIENTS.length },
            { key: 'risk',  label: 'В зоне риска', labelFull: 'Топ в зоне риска',       count: AT_RISK_EXTENDED.length },
            { key: 'card',  label: 'Карточка',     labelFull: 'Карточка клиента',        count: null },
          ] as const).map(({ key, label, labelFull, count }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                tab === key
                  ? 'text-primary border-primary'
                  : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/50'
              }`}>
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
          {STATS.highRisk > 0 && (
            <div className="flex items-center gap-3 bg-error/10 border border-error/20 rounded-xl px-5 py-3.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse flex-shrink-0" />
              <p className="text-sm text-error font-medium">
                <strong>{STATS.highRisk} клиента</strong> просрочили цикл заказа более чем на 10 дней.
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
              onClick={() => { setSelectedClient(c as typeof TODAY_CLIENTS[0]); setTab('card') }}
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
                  selectedClient.id === c.id
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
            <ClientCard
              client={selectedClient}
              onCall={() => setCallClient(selectedClient)}
              onMessage={() => setMessageClient(selectedClient)}
              onMonitor={() => toggleMonitor(selectedClient.id)}
              isMonitored={monitored.has(selectedClient.id)}
            />
          </div>
        </div>
      )}

    </div>
  )
}
