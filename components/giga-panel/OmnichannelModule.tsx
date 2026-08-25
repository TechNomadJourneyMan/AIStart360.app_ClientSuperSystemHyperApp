'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bot,
  Instagram,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  Settings2,
  UserRound,
} from 'lucide-react'
import { MyHonorReactivationPanel } from './MyHonorReactivationPanel'

type Channel = 'instagram' | 'whatsapp'
type Mode = 'off' | 'draft' | 'auto'
type ConversationStatus = 'open' | 'needs_human' | 'resolved' | 'muted'
type WhatsAppWebState = 'disabled' | 'idle' | 'connecting' | 'qr' | 'connected' | 'logged_out' | 'error'

interface ChannelSetting {
  channel: Channel
  enabled: boolean
  mode: Mode
  business_context: string | null
  automation_config: Record<string, unknown>
  confidence_threshold: number
  reply_delay_seconds: number
}

type ChannelSettingPatch = Partial<Pick<
  ChannelSetting,
  'enabled' | 'mode' | 'business_context' | 'confidence_threshold' | 'reply_delay_seconds'
>> & {
  equipment_flow_enabled?: boolean
}

interface InboxMessage {
  id: string
  direction: 'in' | 'out'
  text: string | null
  status: string
  message_type: string
  ai_draft: string | null
  ai_confidence: number | null
  ai_reason: string | null
  ai_generated: boolean
  occurred_at: string
}

interface InboxConversation {
  id: string
  channel: Channel
  status: ConversationStatus
  auto_reply_override: boolean | null
  send_suppressed: boolean
  suppression_reason: string | null
  suppressed_at: string | null
  external_id: string
  contact: {
    id: string
    display_name: string | null
    username: string | null
    phone: string | null
    external_id: string
  }
  intent: string | null
  sentiment: string | null
  lead_score: number | null
  summary: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  last_message: InboxMessage | null
}

interface ConversationDetail {
  conversation: InboxConversation
  messages: InboxMessage[]
}

interface WhatsAppWebConnector {
  configuration: {
    enabled: boolean
    configured: boolean
    missing: string[]
  }
  status?: {
    state: WhatsAppWebState
    connected: boolean
    qr_data_url?: string | null
    updated_at?: string
    error_code?: string | null
  }
}

interface MetaChannelConfiguration {
  configured: boolean
  tokenConfigured: boolean
  accountIdConfigured: boolean
  missing: string[]
}

interface MetaConfiguration {
  instagram: MetaChannelConfiguration
  whatsapp: MetaChannelConfiguration
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function displayName(conversation: InboxConversation): string {
  const c = conversation.contact
  return c.display_name || c.username || c.phone || c.external_id
}

function channelLabel(channel: Channel): string {
  return channel === 'instagram' ? 'Instagram' : 'WhatsApp'
}

function statusLabel(status: ConversationStatus): string {
  if (status === 'needs_human') return 'Нужен человек'
  if (status === 'resolved') return 'Закрыт'
  if (status === 'muted') return 'AI выкл.'
  return 'Открыт'
}

function whatsAppWebStateLabel(state: WhatsAppWebState): string {
  if (state === 'connected') return 'Подключён'
  if (state === 'connecting') return 'Подключаемся'
  if (state === 'qr') return 'Ожидает сканирования QR'
  if (state === 'logged_out') return 'Сессия завершена'
  if (state === 'error') return 'Ошибка'
  if (state === 'disabled') return 'Выключен'
  return 'Не подключён'
}

function equipmentFlowConfig(item: ChannelSetting): Record<string, unknown> | null {
  const value = item.automation_config?.equipment_sales_flow
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function ChannelIcon({ channel, size = 16 }: { channel: Channel; size?: number }) {
  return channel === 'instagram' ? <Instagram size={size} /> : <MessageCircle size={size} />
}

export function OmnichannelModule() {
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [settings, setSettings] = useState<ChannelSetting[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [channel, setChannel] = useState<'all' | Channel>('all')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [backfilling, setBackfilling] = useState<Channel | null>(null)
  const [backfillMonitoring, setBackfillMonitoring] = useState<Channel | null>(null)
  const [savingSetting, setSavingSetting] = useState<Channel | null>(null)
  const [whatsAppWeb, setWhatsAppWeb] = useState<WhatsAppWebConnector | null>(null)
  const [metaConfiguration, setMetaConfiguration] = useState<MetaConfiguration | null>(null)
  const [whatsAppWebLoading, setWhatsAppWebLoading] = useState(true)
  const [whatsAppWebAction, setWhatsAppWebAction] = useState<'connect' | 'logout' | null>(null)
  const settingMutationRef = useRef(false)
  const settingMutationVersionRef = useRef(0)
  const detailRequestRef = useRef(0)
  const selectedIdRef = useRef<string | null>(null)

  const loadConversations = useCallback(async () => {
    const settingsVersion = settingMutationVersionRef.current
    setLoading(true)
    try {
      const suffix = channel === 'all' ? '' : `?channel=${channel}`
      const res = await fetch(`/api/giga-admin/omnichannel/conversations${suffix}`, { cache: 'no-store' })
      const json = (await res.json()) as {
        conversations?: InboxConversation[]; settings?: ChannelSetting[]; error?: string
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      const rows = json.conversations ?? []
      setConversations(rows)
      if (
        settingsVersion === settingMutationVersionRef.current
        && !settingMutationRef.current
      ) setSettings(json.settings ?? [])
      setSelectedId((current) => {
        const next = current && rows.some((row) => row.id === current)
          ? current
          : rows[0]?.id ?? null
        selectedIdRef.current = next
        return next
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить inbox')
    } finally {
      setLoading(false)
    }
  }, [channel])

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/giga-admin/omnichannel/conversations/${id}`, { cache: 'no-store' })
      const json = (await res.json()) as ConversationDetail & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      if (requestId !== detailRequestRef.current || selectedIdRef.current !== id) return
      setDetail(json)
      const draft = [...json.messages].reverse().find((message) =>
        message.direction === 'in'
        && ['drafted', 'needs_human'].includes(message.status)
        && Boolean(message.ai_draft),
      )?.ai_draft
      setReply(draft ?? '')
    } catch (error) {
      if (requestId === detailRequestRef.current) {
        toast.error(error instanceof Error ? error.message : 'Не удалось открыть диалог')
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/giga-admin/omnichannel/settings', { cache: 'no-store' })
      const json = (await res.json()) as {
        settings?: ChannelSetting[]
        configuration?: MetaConfiguration
        error?: string
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      if (!settingMutationRef.current) setSettings(json.settings ?? [])
      if (json.configuration) setMetaConfiguration(json.configuration)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось проверить готовность каналов')
    }
  }, [])

  const loadWhatsAppWeb = useCallback(async (notifyOnError = false) => {
    try {
      const res = await fetch('/api/giga-admin/omnichannel/whatsapp-web', { cache: 'no-store' })
      const json = (await res.json()) as WhatsAppWebConnector & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setWhatsAppWeb(json)
    } catch (error) {
      if (notifyOnError) {
        toast.error(error instanceof Error ? error.message : 'Не удалось получить статус WhatsApp Web')
      }
    } finally {
      setWhatsAppWebLoading(false)
    }
  }, [])

  useEffect(() => { void loadConversations() }, [loadConversations])
  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => { void loadWhatsAppWeb() }, [loadWhatsAppWeb])
  useEffect(() => {
    if (!['connecting', 'qr'].includes(whatsAppWeb?.status?.state ?? '')) return
    const interval = window.setInterval(() => { void loadWhatsAppWeb() }, 3_000)
    return () => window.clearInterval(interval)
  }, [loadWhatsAppWeb, whatsAppWeb?.status?.state])
  useEffect(() => {
    selectedIdRef.current = selectedId
    setDetail(null)
    setReply('')
    if (selectedId) void loadDetail(selectedId)
    else {
      detailRequestRef.current += 1
      setDetailLoading(false)
    }
  }, [selectedId, loadDetail])

  const stats = useMemo(() => ({
    total: conversations.length,
    human: conversations.filter((row) => row.status === 'needs_human').length,
    drafts: conversations.filter((row) => Boolean(row.last_message?.ai_draft)).length,
    leads: conversations.filter((row) => (row.lead_score ?? 0) >= 60).length,
  }), [conversations])

  const whatsAppWebState: WhatsAppWebState = whatsAppWeb?.status?.state
    ?? (whatsAppWeb?.configuration.enabled ? 'idle' : 'disabled')
  const whatsAppWebBusy = whatsAppWebAction !== null || ['connecting', 'qr'].includes(whatsAppWebState)

  function channelAutoReadiness(item: ChannelSetting) {
    const businessContextReady = Boolean(item.business_context?.trim())
    const metaReady = metaConfiguration?.[item.channel]?.configured === true
    const providerReady = metaReady || (
      item.channel === 'whatsapp' && whatsAppWeb?.configuration.configured === true
    )
    return {
      ready: businessContextReady && providerReady,
      businessContextReady,
      providerReady,
    }
  }

  async function patchSetting(item: ChannelSetting, patch: ChannelSettingPatch) {
    if (settingMutationRef.current) return
    settingMutationRef.current = true
    settingMutationVersionRef.current += 1
    setSavingSetting(item.channel)
    try {
      const res = await fetch('/api/giga-admin/omnichannel/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: item.channel, ...patch }),
      })
      const json = (await res.json()) as { setting?: ChannelSetting; error?: string }
      if (!res.ok || !json.setting) throw new Error(json.error || `HTTP ${res.status}`)
      setSettings((rows) => rows.map((row) => row.channel === item.channel ? json.setting! : row))
      toast.success('Настройки сохранены')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения')
    } finally {
      settingMutationRef.current = false
      settingMutationVersionRef.current += 1
      setSavingSetting(null)
    }
  }

  function toggleEquipmentFlow(item: ChannelSetting, enabled: boolean) {
    if (!equipmentFlowConfig(item)) {
      toast.error('Сначала примените миграцию сценария экипировки')
      return
    }
    if (
      enabled
      && !window.confirm(
        'Включить сценарий экипировки? Сначала проверьте его в режиме «Черновик». В режиме «Авто» новые ответы будут уходить клиентам.',
      )
    ) return
    void patchSetting(item, { equipment_flow_enabled: enabled })
  }

  function changeChannelEnabled(item: ChannelSetting, enabled: boolean) {
    if (enabled && item.mode === 'auto' && !channelAutoReadiness(item).ready) {
      toast.error('Сначала подключите канал и заполните проверенную базу ответов')
      return
    }
    if (
      enabled
      && item.mode === 'auto'
      && !window.confirm('Канал сразу включится в режиме автоответа. Продолжить?')
    ) return
    void patchSetting(item, { enabled })
  }

  function changeMode(item: ChannelSetting, mode: Mode) {
    if (mode === 'auto' && !channelAutoReadiness(item).ready) {
      toast.error('Авто недоступно: подключите канал и заполните проверенную базу ответов')
      return
    }
    if (
      mode === 'auto'
      && item.mode !== 'auto'
      && !window.confirm('Включить автоответы? Если канал активен, новые безопасные ответы будут отправляться без подтверждения оператора.')
    ) return
    void patchSetting(item, { mode })
  }

  async function patchConversation(patch: {
    status?: ConversationStatus
    auto_reply_override?: boolean | null
    send_suppressed?: boolean
  }) {
    if (!selectedId) return
    const res = await fetch(`/api/giga-admin/omnichannel/conversations/${selectedId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) return toast.error(json.error || 'Не удалось обновить диалог')
    await Promise.all([loadConversations(), loadDetail(selectedId)])
  }

  async function sendReply() {
    const targetId = detail?.conversation.id
    if (!targetId || targetId !== selectedId || !reply.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/giga-admin/omnichannel/conversations/${targetId}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply.trim() }),
      })
      const json = (await res.json()) as { error?: string; code?: string; warning?: string }
      if (!res.ok) throw new Error(json.error || json.code || `HTTP ${res.status}`)
      setReply('')
      if (json.warning) toast.warning(json.warning)
      else toast.success('Ответ отправлен')
      await loadConversations()
      if (selectedIdRef.current === targetId) await loadDetail(targetId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  const backfillTarget: Channel = channel === 'instagram' ? 'instagram' : 'whatsapp'

  async function startBackfill(target: Channel) {
    setBackfilling(target)
    try {
      const res = await fetch('/api/giga-admin/omnichannel/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: target }),
      })
      const json = (await res.json()) as {
        error?: string
        queued?: boolean
        backend?: string
        workflow_run_id?: string
        candidates_found?: number
        completed?: number
        failed?: number
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      if (target === 'instagram') {
        toast.success('Импорт Instagram запущен — список будет обновляться автоматически')
      } else if (json.queued) {
        toast.success('AI-разбор загруженной истории WhatsApp поставлен в очередь')
      } else if ((json.candidates_found ?? 0) === 0) {
        toast.info('Новых загруженных сообщений WhatsApp для разбора нет')
      } else if ((json.failed ?? 0) > 0) {
        toast.warning(`Разобрано ${json.completed ?? 0}, ошибок: ${json.failed}`)
      } else {
        toast.success(`История WhatsApp разобрана: ${json.completed ?? 0}`)
      }
      await loadConversations()
      if (selectedIdRef.current) await loadDetail(selectedIdRef.current)
      if (json.backend === 'workflow' && json.workflow_run_id) {
        setBackfillMonitoring(target)
        for (const [index, delay] of [5_000, 15_000, 30_000, 60_000].entries()) {
          window.setTimeout(() => {
            void loadConversations()
            if (selectedIdRef.current) void loadDetail(selectedIdRef.current)
            if (index === 3) setBackfillMonitoring(null)
          }, delay)
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Разбор не запущен')
    } finally {
      setBackfilling(null)
    }
  }

  async function changeWhatsAppWebSession(action: 'connect' | 'logout') {
    if (whatsAppWebAction) return
    const confirmed = action === 'connect'
      ? window.confirm(
        'Подключить номер через неофициальный WhatsApp Web/WebSocket? WhatsApp может ограничить или заблокировать аккаунт.',
      )
      : window.confirm('Выйти из WhatsApp Web и удалить текущую QR-сессию? Для повторного входа понадобится новый QR-код.')
    if (!confirmed) return

    setWhatsAppWebAction(action)
    try {
      const res = await fetch('/api/giga-admin/omnichannel/whatsapp-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json()) as Partial<WhatsAppWebConnector> & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      if (json.configuration) setWhatsAppWeb(json as WhatsAppWebConnector)
      await loadWhatsAppWeb(true)
      toast.success(action === 'connect' ? 'Подключение запущено' : 'Сессия WhatsApp Web завершена')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Операция WhatsApp Web не выполнена')
    } finally {
      setWhatsAppWebAction(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-300">
            <MessageCircle size={18} /><h2 className="text-xl font-bold">Единый inbox</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">Instagram + WhatsApp · AI-черновики, автоответы и передача человеку</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void startBackfill(backfillTarget)} disabled={backfilling !== null || backfillMonitoring !== null} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/20 disabled:opacity-50">
            {backfilling || backfillMonitoring ? <Loader2 size={14} className="animate-spin" /> : <ChannelIcon channel={backfillTarget} size={14} />}
            {backfillMonitoring
              ? 'Разбор идёт в фоне…'
              : backfillTarget === 'whatsapp' ? 'Разобрать WhatsApp' : 'Импорт Instagram'}
          </button>
          <button onClick={() => void loadConversations()} aria-label="Обновить" className="p-2 rounded-xl text-slate-400 bg-white/[0.04] border border-white/[0.08]">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Все диалоги', stats.total, 'text-slate-100'],
          ['Нужен человек', stats.human, 'text-amber-300'],
          ['AI-черновики', stats.drafts, 'text-blue-300'],
          ['Горячие лиды', stats.leads, 'text-emerald-300'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4">
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <details open className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
        <summary className="flex items-center gap-2 px-4 py-3 text-xs font-semibold text-slate-300 cursor-pointer"><Settings2 size={14} /> WhatsApp QR, режимы AI и база ответов</summary>
        <div className="grid lg:grid-cols-2 gap-4 p-4 border-t border-white/[0.06]">
          {settings.map((item) => (
            <div key={item.channel} className="rounded-xl bg-black/10 border border-white/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-200"><ChannelIcon channel={item.channel} /> {channelLabel(item.channel)}</span>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={savingSetting !== null || (
                      !item.enabled
                      && item.mode === 'auto'
                      && !channelAutoReadiness(item).ready
                    )}
                    onChange={(event) => changeChannelEnabled(item, event.target.checked)}
                    className="accent-blue-500 disabled:opacity-50"
                  /> активен
                </label>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.03] p-1">
                {(['off', 'draft', 'auto'] as Mode[]).map((mode) => (
                  <button
                    key={mode}
                    disabled={savingSetting !== null || (
                      mode === 'auto' && !channelAutoReadiness(item).ready
                    )}
                    title={mode === 'auto' && !channelAutoReadiness(item).ready
                      ? 'Сначала подключите канал и заполните базу ответов'
                      : undefined}
                    onClick={() => changeMode(item, mode)}
                    className={`px-2 py-2 rounded-lg text-[11px] font-medium disabled:opacity-50 ${item.mode === mode ? 'bg-blue-500/20 text-blue-300 border border-blue-500/20' : 'text-slate-500'}`}
                  >
                    {mode === 'off' ? 'Выкл.' : mode === 'draft' ? 'Черновик' : 'Авто'}
                  </button>
                ))}
              </div>
              <textarea disabled={savingSetting !== null} defaultValue={item.business_context ?? ''} rows={4} placeholder="Товары, цены, график, адреса, FAQ — только проверенные факты" onBlur={(event) => {
                if (event.target.value !== (item.business_context ?? '')) void patchSetting(item, { business_context: event.target.value })
              }} className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-xs text-slate-200 placeholder:text-slate-700 outline-none resize-y disabled:opacity-50" />
              {equipmentFlowConfig(item) && <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 p-3">
                <div><p className="text-[11px] font-semibold text-emerald-300">Сценарий экипировки</p><p className="text-[10px] text-slate-500 mt-0.5">Явный opt-in · сначала проверьте в черновиках</p></div>
                <label className="flex items-center gap-2 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={equipmentFlowConfig(item)?.enabled === true}
                    disabled={savingSetting !== null}
                    onChange={(event) => toggleEquipmentFlow(item, event.target.checked)}
                    className="accent-emerald-500 disabled:opacity-50"
                  />
                  включён
                </label>
              </div>}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-slate-500">
                  Порог уверенности, %
                  <input
                    type="number"
                    min={50}
                    max={100}
                    step={1}
                    disabled={savingSetting !== null}
                    defaultValue={Math.round(item.confidence_threshold * 100)}
                    onBlur={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        void patchSetting(item, {
                          confidence_threshold: Math.min(100, Math.max(50, value)) / 100,
                        })
                      }
                    }}
                    className="mt-1 w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-2.5 py-2 text-xs text-slate-200 outline-none disabled:opacity-50"
                  />
                </label>
                <label className="text-[10px] text-slate-500">
                  Задержка ответа, сек.
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    step={1}
                    disabled={savingSetting !== null}
                    defaultValue={item.reply_delay_seconds}
                    onBlur={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        void patchSetting(item, {
                          reply_delay_seconds: Math.min(86400, Math.max(0, Math.round(value))),
                        })
                      }
                    }}
                    className="mt-1 w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-2.5 py-2 text-xs text-slate-200 outline-none disabled:opacity-50"
                  />
                </label>
              </div>
              <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${
                channelAutoReadiness(item).ready
                  ? 'border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-300'
                  : 'border-amber-500/15 bg-amber-500/[0.05] text-amber-300'
              }`}>
                {channelAutoReadiness(item).ready
                  ? 'Канал и база ответов готовы к режиму «Авто».'
                  : `Авто заблокировано: ${[
                      !channelAutoReadiness(item).providerReady ? 'канал не подключён' : null,
                      !channelAutoReadiness(item).businessContextReady ? 'база ответов пуста' : null,
                    ].filter(Boolean).join(', ')}.`}
              </div>
              <p className="text-[10px] text-slate-600">Auto: только низкий риск, уверенность ≥ {Math.round(item.confidence_threshold * 100)}% и окно 24 часа.</p>
            </div>
          ))}
          <div className="order-first lg:col-span-2 rounded-xl bg-amber-500/[0.035] border border-amber-500/15 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <QrCode size={16} className="text-emerald-300" /> WhatsApp Web по QR
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Экспериментальный WebSocket-коннектор для отдельного постоянно работающего bridge-сервера.</p>
              </div>
              <span className={`w-fit px-2 py-1 rounded-lg border text-[10px] ${
                whatsAppWebState === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : whatsAppWebState === 'error'
                    ? 'bg-red-500/10 text-red-300 border-red-500/20'
                    : ['connecting', 'qr'].includes(whatsAppWebState)
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                      : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
              }`}>
                {whatsAppWebLoading ? 'Проверяем…' : whatsAppWebStateLabel(whatsAppWebState)}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-red-500/[0.07] border border-red-500/20 p-3 text-[10px] leading-relaxed text-red-200/80">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span><strong className="text-red-200">Неофициальное подключение.</strong> WhatsApp Web/WebSocket может нарушать правила WhatsApp и привести к ограничению или блокировке номера. Для production безопаснее официальный WhatsApp Cloud API.</span>
            </div>

            <div className="grid md:grid-cols-[minmax(0,1fr)_220px] gap-4 items-start">
              <div className="space-y-3">
                {whatsAppWebLoading && !whatsAppWeb ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Получаем статус bridge…</div>
                ) : !whatsAppWeb?.configuration.enabled ? (
                  <p className="text-xs text-slate-400">QR-коннектор выключен на сервере. Он не запускается автоматически и не влияет на официальный Cloud API.</p>
                ) : !whatsAppWeb.configuration.configured ? (
                  <p className="text-xs text-slate-400">Bridge-сервер ещё не настроен. Администратору нужно добавить серверные переменные окружения и постоянное хранилище сессии.</p>
                ) : whatsAppWebState === 'connected' ? (
                  <p className="text-xs text-emerald-300">Номер авторизован. Новые входящие сообщения доступны bridge-серверу, пока он работает и сохраняет сессию.</p>
                ) : whatsAppWebState === 'qr' ? (
                  <p className="text-xs text-amber-200/80">Откройте WhatsApp на телефоне → «Связанные устройства» → «Привязка устройства» и отсканируйте QR-код.</p>
                ) : whatsAppWebState === 'connecting' ? (
                  <p className="text-xs text-slate-400">Bridge подключается к WhatsApp и готовит QR-код…</p>
                ) : whatsAppWebState === 'error' ? (
                  <p className="text-xs text-red-300">Bridge сообщил об ошибке{whatsAppWeb.status?.error_code ? `: ${whatsAppWeb.status.error_code}` : '.'}</p>
                ) : (
                  <p className="text-xs text-slate-400">Сессия не активна. После запуска появится QR-код для сканирования телефоном.</p>
                )}

                {whatsAppWeb?.status?.updated_at && (
                  <p className="text-[10px] text-slate-600">Статус обновлён: {formatTime(whatsAppWeb.status.updated_at)}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void changeWhatsAppWebSession('connect')}
                    disabled={
                      whatsAppWebLoading
                      || whatsAppWebBusy
                      || !whatsAppWeb?.configuration.enabled
                      || !whatsAppWeb.configuration.configured
                      || whatsAppWebState === 'connected'
                    }
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 disabled:opacity-40"
                  >
                    {whatsAppWebAction === 'connect' || whatsAppWebState === 'connecting'
                      ? <Loader2 size={14} className="animate-spin" />
                      : <QrCode size={14} />}
                    {whatsAppWebState === 'qr' ? 'Ожидаем сканирования' : 'Получить QR-код'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void changeWhatsAppWebSession('logout')}
                    disabled={
                      whatsAppWebLoading
                      || whatsAppWebAction !== null
                      || !whatsAppWeb?.configuration.enabled
                      || !whatsAppWeb.configuration.configured
                      || ['disabled', 'idle', 'logged_out'].includes(whatsAppWebState)
                    }
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] text-slate-400 border border-white/[0.08] disabled:opacity-40"
                  >
                    {whatsAppWebAction === 'logout' ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                    Завершить сессию
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadWhatsAppWeb(true)}
                    disabled={whatsAppWebLoading || whatsAppWebAction !== null}
                    aria-label="Обновить статус WhatsApp Web"
                    className="p-2 rounded-xl text-slate-400 bg-white/[0.04] border border-white/[0.08] disabled:opacity-40"
                  >
                    <RefreshCw size={14} className={whatsAppWebLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="min-h-[190px] rounded-xl bg-white/[0.96] border border-white/10 p-3 flex items-center justify-center">
                {whatsAppWebState === 'qr' && whatsAppWeb?.status?.qr_data_url ? (
                  <img
                    src={whatsAppWeb.status.qr_data_url}
                    alt="QR-код для подключения WhatsApp Web"
                    width={192}
                    height={192}
                    className="w-48 h-48 object-contain"
                  />
                ) : ['connecting', 'qr'].includes(whatsAppWebState) ? (
                  <div className="text-center text-slate-600"><Loader2 size={24} className="animate-spin mx-auto" /><p className="text-[10px] mt-2">Готовим QR-код…</p></div>
                ) : whatsAppWebState === 'connected' ? (
                  <div className="text-center text-emerald-700"><MessageCircle size={30} className="mx-auto" /><p className="text-xs font-semibold mt-2">WhatsApp подключён</p></div>
                ) : (
                  <div className="text-center text-slate-500"><QrCode size={30} className="mx-auto" /><p className="text-[10px] mt-2">QR появится после запуска</p></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </details>

      <MyHonorReactivationPanel />

      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.07] w-fit">
        {(['all', 'instagram', 'whatsapp'] as const).map((value) => (
          <button key={value} onClick={() => setChannel(value)} className={`px-3 py-2 rounded-lg text-xs ${channel === value ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500'}`}>
            {value === 'all' ? 'Все' : channelLabel(value)}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[330px_minmax(0,1fr)] min-h-[620px] rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.025]">
        <div className="border-b lg:border-b-0 lg:border-r border-white/[0.07] max-h-[620px] overflow-y-auto">
          {loading && conversations.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-slate-600"><Loader2 size={20} className="animate-spin" /></div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center"><MessageCircle size={28} className="mx-auto text-slate-700" /><p className="text-sm text-slate-400 mt-3">Пока нет диалогов</p><p className="text-[11px] text-slate-600 mt-1">Подключите webhook, WhatsApp QR или запустите Instagram-импорт.</p></div>
          ) : conversations.map((item) => (
            <button key={item.id} onClick={() => { selectedIdRef.current = item.id; setSelectedId(item.id) }} className={`w-full text-left p-4 border-b border-white/[0.05] hover:bg-white/[0.04] ${selectedId === item.id ? 'bg-blue-500/[0.08]' : ''}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-2 rounded-xl ${item.channel === 'instagram' ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'bg-emerald-500/15 text-emerald-300'}`}><ChannelIcon channel={item.channel} size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-200 truncate">{displayName(item)}</p><span className="text-[9px] text-slate-600 flex-shrink-0">{formatTime(item.last_message_at)}</span></div>
                  <p className="text-[11px] text-slate-500 truncate mt-1">{item.last_message?.text || item.summary || '[нет текста]'}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${item.status === 'needs_human' ? 'bg-amber-500/15 text-amber-300' : 'bg-white/[0.05] text-slate-500'}`}>{statusLabel(item.status)}</span>
                    {item.last_message?.ai_draft && <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/15 text-blue-300">AI-черновик</span>}
                    {(item.lead_score ?? 0) >= 60 && <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/15 text-emerald-300">лид {item.lead_score}</span>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex flex-col max-h-[760px]">
          {!selectedId ? <div className="flex-1 flex items-center justify-center text-sm text-slate-600">Выберите диалог</div> : detailLoading && !detail ? <div className="flex-1 flex items-center justify-center text-slate-600"><Loader2 className="animate-spin" /></div> : detail && detail.conversation.id === selectedId ? <>
            <div className="p-4 border-b border-white/[0.07] flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-100 truncate">{displayName(detail.conversation)}</p><p className="text-[11px] text-slate-500 mt-1">{channelLabel(detail.conversation.channel)}{detail.conversation.intent ? ` · ${detail.conversation.intent}` : ''}{detail.conversation.lead_score != null ? ` · лид ${detail.conversation.lead_score}/100` : ''}</p>{detail.conversation.summary && <p className="text-[11px] text-slate-400 mt-2 max-w-2xl">{detail.conversation.summary}</p>}</div>
              <div className="flex gap-1 flex-wrap"><button onClick={() => void patchConversation({ status: 'open' })} className="px-2 py-1.5 rounded-lg text-[10px] text-blue-300 bg-blue-500/10 border border-blue-500/15">В работу</button><button onClick={() => void patchConversation({ status: 'resolved' })} className="px-2 py-1.5 rounded-lg text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/15">Закрыть</button><button onClick={() => void patchConversation({ status: 'muted' })} className="px-2 py-1.5 rounded-lg text-[10px] text-slate-400 bg-white/[0.04] border border-white/[0.07]">AI выкл.</button>{detail.conversation.auto_reply_override === false && <button onClick={() => void patchConversation({ auto_reply_override: null, status: 'open' })} className="px-2 py-1.5 rounded-lg text-[10px] text-violet-300 bg-violet-500/10 border border-violet-500/15">Вернуть AI</button>}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[320px]">
              {detail.messages.map((message) => <div key={message.id} className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${message.direction === 'out' ? 'bg-blue-500/15 border border-blue-500/20' : 'bg-white/[0.05] border border-white/[0.07]'}`}><div className="flex items-center gap-1.5 mb-1">{message.direction === 'out' ? message.ai_generated ? <Bot size={11} className="text-blue-300" /> : <UserRound size={11} className="text-blue-300" /> : <UserRound size={11} className="text-slate-500" />}<span className="text-[9px] text-slate-600">{message.direction === 'out' ? message.ai_generated ? 'AI' : 'Оператор' : 'Клиент'} · {formatTime(message.occurred_at)}</span></div><p className="text-xs text-slate-200 whitespace-pre-wrap break-words">{message.text || `[тип: ${message.message_type}]`}</p><p className="text-[9px] text-slate-600 mt-1">{message.status}</p></div></div>)}
            </div>
            {detail.messages.some((message) => message.ai_draft) && <div className="mx-4 mb-3 rounded-xl bg-blue-500/[0.07] border border-blue-500/15 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-blue-300 uppercase tracking-wider"><Bot size={13} /> AI-черновик — проверьте</div><p className="text-[10px] text-slate-500 mt-1">Старые диалоги не рассылаются автоматически; Meta может запретить ответ вне окна.</p></div>}
            <div className="p-4 border-t border-white/[0.07]">
              {detail.conversation.send_suppressed && <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-red-500/[0.08] border border-red-500/20 p-3 mb-3"><div className="flex items-center gap-2 text-[10px] text-red-300"><AlertTriangle size={13} /> Клиент отказался от сообщений — отправка заблокирована.</div><button onClick={() => { if (window.confirm('Подтверждено новое явное согласие клиента на сообщения?')) void patchConversation({ send_suppressed: false, status: 'open', auto_reply_override: null }) }} className="px-2.5 py-1.5 rounded-lg text-[10px] text-red-200 border border-red-500/25 bg-red-500/10">Re-opt-in подтверждён</button></div>}
              {detail.conversation.status === 'needs_human' && <div className="flex items-center gap-2 text-[10px] text-amber-300 mb-2"><AlertTriangle size={12} /> AI передал этот диалог человеку.</div>}
              <div className="flex gap-2 items-end"><textarea value={reply} onChange={(event) => setReply(event.target.value)} disabled={detail.conversation.send_suppressed} rows={3} maxLength={1000} placeholder="Ответить от имени AIStart360…" className="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-xs text-slate-200 placeholder:text-slate-700 outline-none resize-none disabled:opacity-40" /><button onClick={() => void sendReply()} disabled={detail.conversation.send_suppressed || detail.conversation.id !== selectedId || !reply.trim() || sending} className="h-10 px-4 rounded-xl flex items-center gap-2 text-xs font-semibold bg-blue-500 text-white disabled:opacity-40">{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Отправить</button></div>
            </div>
          </> : null}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 px-4 py-3 text-[11px] text-amber-200/70"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>WhatsApp Cloud API не умеет загружать произвольную старую историю. «Разобрать WhatsApp» анализирует только сообщения, уже полученные через QR-bridge, и создаёт черновики без автоматической отправки. Instagram вернёт не более 20 последних детальных сообщений за запуск.</span></div>
    </div>
  )
}
