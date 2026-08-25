'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type CampaignState = 'draft' | 'approved' | 'running' | 'paused' | 'completed'
type CampaignSegment =
  | 'old_lead'
  | 'abandoned_cart'
  | 'registered_no_order'
  | 'dormant_customer'
  | 'post_purchase'
  | 'seasonal'
  | 'club_interest'
  | 'back_in_stock'
type CampaignInterest =
  | 'hunting'
  | 'fishing'
  | 'outdoor'
  | 'mountains'
  | 'tactical'
  | 'footwear'
  | 'base_layer'
  | 'accessories'
type CampaignSeason = 'spring' | 'summer' | 'autumn' | 'winter' | 'all_season'

interface CampaignSummary {
  id: string
  name: string
  segment: CampaignSegment | string
  state: CampaignState
  dryRun: boolean
  createdAt: string
  recipientCount: number
  queuedCount: number
  acceptedCount: number
  excludedCount: number
  holdoutCount: number
  previewSnapshotHash: string | null
  approvalSnapshotHash: string | null
  templateContractHash: string | null
}

interface Readiness {
  ingest_ready: boolean
  send_enabled: boolean
  send_ready: boolean
  missing_for_ingest: string[]
  missing_for_send: string[]
}

interface Overview {
  campaign_count: number
  recipient_count: number
  queued_count: number
  accepted_count: number
  excluded_count: number
  holdout_count: number
  states: Record<string, number>
  contacts?: {
    total: number
    with_effective_consent: number
    globally_suppressed: number
    provider_marketing_limited: number
  }
  exclusion_reasons?: Record<string, number>
}

interface OverviewResponse {
  ok: boolean
  overview?: Overview
  readiness?: Readiness
  error?: ApiError
}

interface CampaignsResponse {
  ok: boolean
  items?: CampaignSummary[]
  error?: ApiError
}

interface ApiError {
  code?: string
  message?: string
  details?: { missing?: string[] }
}

interface CampaignForm {
  name: string
  segment: CampaignSegment
  interest: CampaignInterest | ''
  season: CampaignSeason | ''
  inactivity_days: number
  frequency_cap_days: number
  monthly_cap: number
  daily_limit: number
  holdout_percent: number
  product_limit: number
  dry_run: boolean
  utm_campaign: string
}

interface PreviewEvidence {
  approvalSnapshotHash: string
  templateContractHash: string | null
  previewCount: number
  queuedCount: number
  holdoutCount: number
  excludedCount: number
  exclusionReasons: Record<string, number>
  recipients: RecipientPreview[]
  recipientTotal: number
  nextOffset: number | null
  reviewed: boolean
}

interface RecipientPreview {
  id: string
  previewSnapshotHash: string
  phoneMasked: string
  locale: 'ru' | 'kk'
  state: string
  exclusionReason: string | null
  holdout: boolean
  consent: Record<string, unknown>
  eligibility: Record<string, unknown>
  recommendation: Record<string, unknown>
  templateParametersHash: string
  templateParameters: string[]
  messagePreview: string | null
  runAt: string
}

type ConfirmationKind = 'approve' | 'launch' | 'pause'

interface PendingConfirmation {
  kind: ConfirmationKind
  campaign: CampaignSummary
}

const SEGMENTS: Array<{ value: CampaignSegment; label: string }> = [
  { value: 'old_lead', label: 'Давний лид' },
  { value: 'abandoned_cart', label: 'Брошенная корзина' },
  { value: 'registered_no_order', label: 'Регистрация без заказа' },
  { value: 'dormant_customer', label: 'Покупатель давно не возвращался' },
  { value: 'post_purchase', label: 'После покупки' },
  { value: 'seasonal', label: 'Сезонная подборка' },
  { value: 'club_interest', label: 'Интерес к Honor Club' },
  { value: 'back_in_stock', label: 'Снова в наличии' },
]

const INTERESTS: Array<{ value: CampaignInterest; label: string }> = [
  { value: 'hunting', label: 'Охота' },
  { value: 'fishing', label: 'Рыбалка' },
  { value: 'outdoor', label: 'Активный отдых' },
  { value: 'mountains', label: 'Горы' },
  { value: 'tactical', label: 'Тактика' },
  { value: 'footwear', label: 'Обувь' },
  { value: 'base_layer', label: 'Базовый слой' },
  { value: 'accessories', label: 'Аксессуары' },
]

const SEASONS: Array<{ value: CampaignSeason; label: string }> = [
  { value: 'spring', label: 'Весна' },
  { value: 'summer', label: 'Лето' },
  { value: 'autumn', label: 'Осень' },
  { value: 'winter', label: 'Зима' },
  { value: 'all_season', label: 'Всесезонно' },
]

const DEFAULT_FORM: CampaignForm = {
  name: 'Реактивация MyHonor',
  segment: 'old_lead',
  interest: '',
  season: '',
  inactivity_days: 90,
  frequency_cap_days: 14,
  monthly_cap: 2,
  daily_limit: 10,
  holdout_percent: 10,
  product_limit: 2,
  dry_run: true,
  utm_campaign: 'myhonor_reactivation',
}

const CONFIRMATION_TEXT: Record<ConfirmationKind, string> = {
  approve: 'APPROVE_MYHONOR_CAMPAIGN',
  launch: 'LAUNCH_MYHONOR_CAMPAIGN',
  pause: 'PAUSE_MYHONOR_CAMPAIGN',
}

const TEMPLATE_PREFIX = 'WHATSAPP_TEMPLATE_REACTIVATION_'
const TEMPLATE_COUNT = SEGMENTS.length

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function stateLabel(state: CampaignState): string {
  if (state === 'approved') return 'Одобрена'
  if (state === 'running') return 'Запущена'
  if (state === 'paused') return 'На паузе'
  if (state === 'completed') return 'Завершена'
  return 'Черновик'
}

function segmentLabel(segment: string): string {
  return SEGMENTS.find((item) => item.value === segment)?.label ?? segment
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function countRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, count]) =>
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
      ? [[key, count]]
      : [],
  ))
}

function safeRecordText(value: Record<string, unknown>, key: string): string {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : '—'
}

function safeRecordStrings(value: Record<string, unknown>, key: string): string[] {
  const candidate = value[key]
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string')
    : []
}

function exclusionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    application_ineligible: 'не прошёл правила',
    global_suppression: 'запрет сообщений',
    missing_consent: 'нет согласия',
    unresolved_complaint: 'есть претензия',
    source_snapshot_stale: 'данные магазина устарели',
    source_snapshot_changed: 'данные изменились после проверки',
    manual_hold: 'нужна ручная проверка',
    provider_cooldown: 'лимит WhatsApp',
    invalid_recommendation: 'подборка не проверена',
    insufficient_personalization: 'недостаточно данных для точной подборки',
    inactive_product: 'товар недоступен',
    frequency_cap: 'частотный лимит',
    monthly_frequency_cap: 'месячный лимит',
  }
  return labels[reason] ?? reason.replaceAll('_', ' ')
}

function validateCampaignForm(form: CampaignForm, sendReady: boolean): string | null {
  if (form.name.trim().length < 3) return 'Название должно содержать минимум 3 символа.'
  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(form.utm_campaign.trim())) {
    return 'UTM: 3–100 символов, только a–z, цифры, дефис и подчёркивание.'
  }
  if (form.segment === 'seasonal' && !form.season) {
    return 'Для сезонной кампании выберите сезон.'
  }
  if (!form.dry_run && !sendReady) {
    return 'Боевая кампания заблокирована: Cloud API, шаблоны или глобальный флаг не готовы.'
  }
  return null
}

function stateBadgeClass(state: CampaignState): string {
  return cn(
    'border-white/[0.08] bg-white/[0.04] text-slate-400',
    state === 'approved' && 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    state === 'running' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    state === 'paused' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    state === 'completed' && 'border-slate-500/20 bg-slate-500/10 text-slate-300',
  )
}

function ReadinessBadge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium',
      ready
        ? 'border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300'
        : 'border-amber-500/20 bg-amber-500/[0.08] text-amber-300',
    )}>
      {ready ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {label}
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[10px] font-medium text-slate-500">{children}</span>
}

export function MyHonorReactivationPanel() {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [form, setForm] = useState<CampaignForm>(DEFAULT_FORM)
  const [previewEvidence, setPreviewEvidence] = useState<Record<string, PreviewEvidence>>({})
  const [loading, setLoading] = useState(true)
  const [dataHealthy, setDataHealthy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [mutation, setMutation] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [campaignErrors, setCampaignErrors] = useState<Record<string, string>>({})
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [confirmationValue, setConfirmationValue] = useState('')
  const [confirmationError, setConfirmationError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setDataHealthy(false)
    setPanelError(null)
    try {
      const [overviewResponse, campaignsResponse] = await Promise.all([
        fetch('/api/giga-admin/myhonor/reactivation/overview', { cache: 'no-store' }),
        fetch('/api/giga-admin/myhonor/reactivation/campaigns?limit=50', { cache: 'no-store' }),
      ])
      const [overviewPayload, campaignsPayload] = await Promise.all([
        overviewResponse.json() as Promise<OverviewResponse>,
        campaignsResponse.json() as Promise<CampaignsResponse>,
      ])

      if (!overviewResponse.ok || !overviewPayload.ok || !overviewPayload.readiness) {
        setReadiness(null)
        setOverview(null)
        setPanelError(apiErrorMessage(overviewPayload, 'Готовность реактивации не подтверждена. Любые действия заблокированы.'))
      } else {
        setReadiness(overviewPayload.readiness)
        setOverview(overviewPayload.overview ?? null)
      }

      if (!campaignsResponse.ok || !campaignsPayload.ok) {
        setCampaigns([])
        setPanelError((current) => current
          ?? apiErrorMessage(campaignsPayload, 'Список кампаний временно недоступен.'))
      } else {
        setCampaigns(campaignsPayload.items ?? [])
      }
      setDataHealthy(
        overviewResponse.ok
        && overviewPayload.ok
        && Boolean(overviewPayload.readiness)
        && campaignsResponse.ok
        && campaignsPayload.ok,
      )
    } catch {
      setReadiness(null)
      setOverview(null)
      setCampaigns([])
      setDataHealthy(false)
      setPanelError('Нет связи с модулем реактивации. Отправка закрыта до успешной проверки.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const missingTemplates = useMemo(
    () => readiness?.missing_for_send.filter((name) => name.startsWith(TEMPLATE_PREFIX)) ?? [],
    [readiness],
  )
  const configuredTemplates = readiness
    ? Math.max(0, TEMPLATE_COUNT - missingTemplates.length)
    : 0
  const safeToCreateDraft = dataHealthy
    && readiness?.ingest_ready === true
    && !loading
    && mutation === null
  const safeToCreateLive = safeToCreateDraft && readiness?.send_ready === true

  function updateNumber<K extends keyof Pick<CampaignForm,
    | 'inactivity_days'
    | 'frequency_cap_days'
    | 'monthly_cap'
    | 'daily_limit'
    | 'holdout_percent'
    | 'product_limit'
  >>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: numberValue(value, current[key]) }))
  }

  async function createCampaign() {
    if (!safeToCreateDraft || creating) return
    const validationError = validateCampaignForm(form, readiness?.send_ready === true)
    if (validationError) {
      setFormError(validationError)
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const response = await fetch('/api/giga-admin/myhonor/reactivation/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          interest: form.interest || null,
          season: form.season || null,
          utm_campaign: form.utm_campaign.trim(),
        }),
      })
      const payload = await response.json() as { ok?: boolean; error?: ApiError }
      if (!response.ok || payload.ok !== true) {
        throw new Error(apiErrorMessage(payload, 'Кампанию не удалось создать.'))
      }
      toast.success(form.dry_run
        ? 'Тестовая кампания создана. Теперь запустите предпросмотр.'
        : 'Боевая кампания создана, но ещё ничего не отправляет.')
      setForm(DEFAULT_FORM)
      await loadData()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Кампанию не удалось создать.')
    } finally {
      setCreating(false)
    }
  }

  async function previewCampaign(campaign: CampaignSummary) {
    if (mutation || !readiness?.ingest_ready) return
    setMutation(`${campaign.id}:preview`)
    setCampaignErrors((current) => ({ ...current, [campaign.id]: '' }))
    try {
      const response = await fetch(
        `/api/giga-admin/myhonor/reactivation/campaigns/${campaign.id}/preview`,
        { method: 'POST' },
      )
      const payload = await response.json() as {
        ok?: boolean
        error?: ApiError
        approvalSnapshotHash?: string
        templateContractHash?: string | null
        materialized?: {
          previewCount?: number
          queuedCount?: number
          holdoutCount?: number
          excludedCount?: number
        }
        overview?: {
          exclusion_reasons?: Record<string, number>
        }
        recipientPreview?: {
          items?: RecipientPreview[]
          shown?: number
          total?: number
          nextOffset?: number | null
        }
      }
      if (!response.ok || payload.ok !== true || !payload.approvalSnapshotHash) {
        throw new Error(apiErrorMessage(payload, 'Предпросмотр не сформирован.'))
      }
      const materialized = payload.materialized ?? {}
      setPreviewEvidence((current) => ({
        ...current,
        [campaign.id]: {
          approvalSnapshotHash: payload.approvalSnapshotHash!,
          templateContractHash: payload.templateContractHash ?? null,
          previewCount: materialized.previewCount ?? 0,
          queuedCount: materialized.queuedCount ?? 0,
          holdoutCount: materialized.holdoutCount ?? 0,
          excludedCount: materialized.excludedCount ?? 0,
          exclusionReasons: countRecord(payload.overview?.exclusion_reasons),
          recipients: payload.recipientPreview?.items ?? [],
          recipientTotal: payload.recipientPreview?.total ?? 0,
          nextOffset: payload.recipientPreview?.nextOffset ?? null,
          reviewed: false,
        },
      }))
      toast.success('Предпросмотр зафиксирован. Сообщения не отправлены.')
      await loadData()
    } catch (error) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: error instanceof Error ? error.message : 'Предпросмотр не сформирован.',
      }))
    } finally {
      setMutation(null)
    }
  }

  function evidenceForCampaign(campaign: CampaignSummary): PreviewEvidence | undefined {
    const local = previewEvidence[campaign.id]
    if (local) return local
    const recoveredHash = campaign.state === 'draft'
      ? campaign.previewSnapshotHash
      : campaign.approvalSnapshotHash
    if (!recoveredHash || !/^[a-f0-9]{64}$/.test(recoveredHash)) return undefined
    return {
      approvalSnapshotHash: recoveredHash,
      templateContractHash: campaign.templateContractHash,
      previewCount: campaign.dryRun ? campaign.recipientCount : 0,
      queuedCount: campaign.queuedCount,
      holdoutCount: campaign.holdoutCount,
      excludedCount: campaign.excludedCount,
      exclusionReasons: {},
      recipients: [],
      recipientTotal: campaign.recipientCount,
      nextOffset: campaign.recipientCount > 0 ? 0 : null,
      reviewed: campaign.state !== 'draft',
    }
  }

  async function loadMoreRecipientPreviews(campaign: CampaignSummary) {
    const evidence = evidenceForCampaign(campaign)
    if (!evidence || evidence.nextOffset === null || mutation) return
    setMutation(`${campaign.id}:recipient-preview`)
    setCampaignErrors((current) => ({ ...current, [campaign.id]: '' }))
    try {
      const query = new URLSearchParams({
        snapshot_hash: evidence.approvalSnapshotHash,
        limit: '50',
        offset: String(evidence.nextOffset),
      })
      const response = await fetch(
        `/api/giga-admin/myhonor/reactivation/campaigns/${campaign.id}/recipients?${query}`,
        { cache: 'no-store' },
      )
      const payload = await response.json() as {
        ok?: boolean
        items?: RecipientPreview[]
        page?: { next_offset?: number | null }
      }
      if (!response.ok || payload.ok !== true) {
        throw new Error(apiErrorMessage(payload, 'Детали получателей не загружены.'))
      }
      const items = payload.items ?? []
      setPreviewEvidence((current) => ({
        ...current,
        [campaign.id]: {
          ...evidence,
          recipients: [...evidence.recipients, ...items],
          nextOffset: payload.page?.next_offset ?? null,
          reviewed: false,
        },
      }))
    } catch (error) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: error instanceof Error
          ? error.message
          : 'Детали получателей не загружены.',
      }))
    } finally {
      setMutation(null)
    }
  }

  function markRecipientPreviewReviewed(campaign: CampaignSummary) {
    const evidence = evidenceForCampaign(campaign)
    if (
      !evidence
      || evidence.nextOffset !== null
      || evidence.recipients.length !== evidence.recipientTotal
    ) return
    setPreviewEvidence((current) => ({
      ...current,
      [campaign.id]: { ...evidence, reviewed: true },
    }))
    toast.success('Состав аудитории и параметры сообщений отмечены как просмотренные.')
  }

  function openConfirmation(kind: ConfirmationKind, campaign: CampaignSummary) {
    if ((kind === 'approve' || kind === 'launch') && !evidenceForCampaign(campaign)) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: 'Сначала сформируйте свежий предпросмотр в этой сессии.',
      }))
      return
    }
    if (kind === 'approve' && !evidenceForCampaign(campaign)?.reviewed) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: 'Загрузите все строки и подтвердите просмотр аудитории.',
      }))
      return
    }
    if (kind === 'approve' && (!dataHealthy || readiness?.ingest_ready !== true)) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: 'Одобрение закрыто: готовность данных не подтверждена.',
      }))
      return
    }
    if (kind === 'launch' && (campaign.dryRun || readiness?.send_ready !== true)) {
      setCampaignErrors((current) => ({
        ...current,
        [campaign.id]: 'Запуск закрыт: кампания тестовая или Cloud API не готов.',
      }))
      return
    }
    setConfirmation({ kind, campaign })
    setConfirmationValue('')
    setConfirmationError(null)
  }

  function closeConfirmation() {
    if (mutation) return
    setConfirmation(null)
    setConfirmationValue('')
    setConfirmationError(null)
  }

  async function performConfirmedAction() {
    if (!confirmation || mutation) return
    const requiredText = CONFIRMATION_TEXT[confirmation.kind]
    if (confirmationValue !== requiredText) {
      setConfirmationError('Подтверждение не совпадает. Скопируйте фразу точно.')
      return
    }
    const { kind, campaign } = confirmation
    const evidence = evidenceForCampaign(campaign)
    if ((kind === 'approve' || kind === 'launch') && !evidence) {
      setConfirmationError('Точный снимок предпросмотра отсутствует. Действие заблокировано.')
      return
    }
    if (kind === 'approve' && !evidence?.reviewed) {
      setConfirmationError('Перед одобрением нужно просмотреть всю аудиторию.')
      return
    }
    if (kind === 'approve' && (!dataHealthy || readiness?.ingest_ready !== true)) {
      setConfirmationError('Готовность данных не подтверждена. Действие заблокировано.')
      return
    }
    if (kind === 'launch' && (campaign.dryRun || readiness?.send_ready !== true)) {
      setConfirmationError('Боевая отправка не готова. Действие заблокировано.')
      return
    }

    setMutation(`${campaign.id}:${kind}`)
    setConfirmationError(null)
    try {
      const body = kind === 'pause'
        ? undefined
        : JSON.stringify({
            approval_snapshot_hash: evidence!.approvalSnapshotHash,
            confirmation: CONFIRMATION_TEXT[kind],
          })
      const response = await fetch(
        `/api/giga-admin/myhonor/reactivation/campaigns/${campaign.id}/${kind}`,
        {
          method: 'POST',
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
        },
      )
      const payload = await response.json() as { ok?: boolean; error?: ApiError }
      if (!response.ok || payload.ok !== true) {
        throw new Error(apiErrorMessage(payload, 'Действие не выполнено.'))
      }
      const successText = kind === 'approve'
        ? 'Кампания одобрена. Отправка ещё не началась.'
        : kind === 'launch'
          ? 'Кампания передана в очередь официального WhatsApp Cloud API.'
          : 'Кампания приостановлена.'
      toast.success(successText)
      setConfirmation(null)
      setConfirmationValue('')
      await loadData()
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : 'Действие не выполнено.')
    } finally {
      setMutation(null)
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden" aria-labelledby="myhonor-reactivation-title">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-emerald-300">
            <Megaphone size={16} />
            <h3 id="myhonor-reactivation-title" className="text-sm font-semibold text-balance">Возврат клиентов MyHonor.shop</h3>
          </div>
          <p className="mt-1 max-w-3xl text-[10px] text-slate-500 text-pretty">
            Только клиенты с доказанным маркетинговым согласием. Предпросмотр не отправляет сообщения; QR-bridge для рассылок не используется.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading || mutation !== null || creating}
          aria-label="Обновить готовность и кампании реактивации"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge ready={readiness?.ingest_ready === true} label="Согласия и профили" />
          <ReadinessBadge ready={readiness?.send_enabled === true} label="Глобальная отправка" />
          <ReadinessBadge ready={readiness?.send_ready === true} label="Cloud API готов" />
          <ReadinessBadge
            ready={configuredTemplates === TEMPLATE_COUNT}
            label={`Шаблоны ${configuredTemplates}/${TEMPLATE_COUNT}`}
          />
          {loading && <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500"><Loader2 size={11} /> Проверяем…</span>}
        </div>

        {panelError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3 py-2.5 text-[10px] text-red-300">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span className="text-pretty">{panelError}</span>
          </div>
        )}

        {readiness && !readiness.send_ready && (
          <details className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
            <summary className="cursor-pointer text-[10px] font-medium text-amber-300">
              Боевая отправка закрыта · не хватает {readiness.missing_for_send.length} настроек
            </summary>
            <p className="mt-2 break-words font-mono text-[9px] leading-relaxed text-slate-500 text-pretty">
              {readiness.missing_for_send.join(', ') || 'Причина не раскрыта сервером.'}
            </p>
          </details>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Кампании', overview?.campaign_count ?? campaigns.length],
            ['Получатели', overview?.recipient_count ?? 0],
            ['Принято API', overview?.accepted_count ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
              <p className="text-lg font-semibold tabular-nums text-slate-200">{value}</p>
              <p className="text-[9px] text-slate-600">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[11px] font-semibold tabular-nums text-slate-300">
              {overview?.contacts
                ? `${overview.contacts.with_effective_consent} / ${overview.contacts.total}`
                : '—'}
            </p>
            <p className="mt-0.5 text-[9px] text-slate-600">Контакты с действующим согласием</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[11px] font-semibold tabular-nums text-slate-300">{overview?.contacts?.globally_suppressed ?? '—'}</p>
            <p className="mt-0.5 text-[9px] text-slate-600">Запрещены к отправке</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[11px] font-semibold tabular-nums text-slate-300">{overview?.contacts?.provider_marketing_limited ?? '—'}</p>
            <p className="mt-0.5 text-[9px] text-slate-600">Ограничены WhatsApp</p>
          </div>
        </div>

        {overview?.exclusion_reasons && Object.keys(overview.exclusion_reasons).length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[10px] font-medium text-slate-400">Причины исключения</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(overview.exclusion_reasons).map(([reason, count]) => (
                <span key={reason} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[9px] text-slate-500">
                  {exclusionReasonLabel(reason)}: <span className="tabular-nums text-slate-300">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <details className="rounded-xl border border-white/[0.06] bg-black/10">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-3 text-xs font-semibold text-slate-300">
            <Plus size={14} className="text-blue-300" /> Создать кампанию
          </summary>
          <form
            className="grid gap-3 border-t border-white/[0.06] p-3 sm:grid-cols-2 xl:grid-cols-4"
            onSubmit={(event) => { event.preventDefault(); void createCampaign() }}
          >
            <label className="sm:col-span-2">
              <FieldLabel>Название</FieldLabel>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                maxLength={160}
                disabled={!safeToCreateDraft || creating}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40"
              />
            </label>
            <label>
              <FieldLabel>Сегмент</FieldLabel>
              <select
                value={form.segment}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  segment: event.target.value as CampaignSegment,
                }))}
                disabled={!safeToCreateDraft || creating}
                className="w-full rounded-lg border border-white/[0.08] bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40"
              >
                {SEGMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <FieldLabel>Интерес</FieldLabel>
              <select
                value={form.interest}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  interest: event.target.value as CampaignInterest | '',
                }))}
                disabled={!safeToCreateDraft || creating}
                className="w-full rounded-lg border border-white/[0.08] bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40"
              >
                <option value="">Любой</option>
                {INTERESTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <FieldLabel>Сезон</FieldLabel>
              <select
                value={form.season}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  season: event.target.value as CampaignSeason | '',
                }))}
                disabled={!safeToCreateDraft || creating}
                className="w-full rounded-lg border border-white/[0.08] bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40"
              >
                <option value="">Любой</option>
                {SEASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <FieldLabel>Неактивность, дней</FieldLabel>
              <input type="number" min={3} max={730} value={form.inactivity_days} onChange={(event) => updateNumber('inactivity_days', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label>
              <FieldLabel>Не чаще, дней</FieldLabel>
              <input type="number" min={7} max={365} value={form.frequency_cap_days} onChange={(event) => updateNumber('frequency_cap_days', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label>
              <FieldLabel>Максимум в месяц</FieldLabel>
              <input type="number" min={1} max={3} value={form.monthly_cap} onChange={(event) => updateNumber('monthly_cap', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label>
              <FieldLabel>Лимит в день</FieldLabel>
              <input type="number" min={1} max={100} value={form.daily_limit} onChange={(event) => updateNumber('daily_limit', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label>
              <FieldLabel>Контрольная группа, %</FieldLabel>
              <input type="number" min={0} max={50} value={form.holdout_percent} onChange={(event) => updateNumber('holdout_percent', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label>
              <FieldLabel>Товаров в подборке</FieldLabel>
              <input type="number" min={1} max={3} value={form.product_limit} onChange={(event) => updateNumber('product_limit', event.target.value)} disabled={!safeToCreateDraft || creating} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-xs tabular-nums text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40" />
            </label>
            <label className="sm:col-span-2">
              <FieldLabel>UTM campaign</FieldLabel>
              <input
                value={form.utm_campaign}
                onChange={(event) => setForm((current) => ({ ...current, utm_campaign: event.target.value.toLowerCase() }))}
                maxLength={100}
                disabled={!safeToCreateDraft || creating}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 font-mono text-xs text-slate-200 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40"
              />
            </label>

            <div className="flex flex-col gap-2 sm:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-start gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-2 text-[10px] text-emerald-200">
                <input
                  type="checkbox"
                  checked={form.dry_run}
                  onChange={(event) => setForm((current) => ({ ...current, dry_run: event.target.checked }))}
                  disabled={!safeToCreateDraft || creating || !safeToCreateLive}
                  className="mt-0.5 accent-emerald-500 disabled:opacity-40"
                />
                <span className="text-pretty">
                  Тестовый режим: сформировать аудиторию и рекомендации, ничего не отправлять.
                  {!safeToCreateLive && ' Боевой режим заблокирован сервером.'}
                </span>
              </label>
              <button
                type="submit"
                disabled={!safeToCreateDraft || creating}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/15 px-4 text-xs font-semibold text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40"
              >
                {creating ? <Loader2 size={14} /> : <Plus size={14} />}
                {creating ? 'Создаём…' : 'Создать без запуска'}
              </button>
            </div>
            {formError && <p role="alert" className="text-[10px] text-red-300 sm:col-span-2 xl:col-span-4 text-pretty">{formError}</p>}
          </form>
        </details>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-slate-300 text-balance">Последние кампании</h4>
            <span className="text-[9px] text-slate-600">Полные номера и имена не раскрываются</span>
          </div>
          {loading && campaigns.length === 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1].map((item) => <div key={item} className="h-28 rounded-xl border border-white/[0.06] bg-white/[0.03]" />)}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center">
              <p className="text-xs text-slate-400">Кампаний пока нет.</p>
              <p className="mt-1 text-[10px] text-slate-600 text-pretty">Откройте форму выше и начните с безопасного тестового режима.</p>
            </div>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {campaigns.map((campaign) => {
                const evidence = evidenceForCampaign(campaign)
                const rowBusy = mutation?.startsWith(`${campaign.id}:`) === true
                const canPreview = campaign.state === 'draft' && readiness?.ingest_ready === true
                const canApprove = campaign.state === 'draft'
                  && !campaign.dryRun
                  && dataHealthy
                  && readiness?.ingest_ready === true
                  && evidence?.reviewed === true
                  && (evidence?.recipientTotal ?? 0) > 0
                const canLaunch = (campaign.state === 'approved' || campaign.state === 'paused')
                  && !campaign.dryRun
                  && readiness?.send_ready === true
                  && Boolean(evidence)
                return (
                  <article key={campaign.id} className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-200">{campaign.name}</p>
                        <p className="mt-1 text-[9px] text-slate-600">
                          {segmentLabel(campaign.segment)} · {formatDate(campaign.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap justify-end gap-1">
                        {campaign.dryRun && <span className="rounded-md border border-slate-500/20 bg-slate-500/10 px-1.5 py-0.5 text-[8px] text-slate-400">тест</span>}
                        <span className={cn('rounded-md border px-1.5 py-0.5 text-[8px]', stateBadgeClass(campaign.state))}>{stateLabel(campaign.state)}</span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-1 text-center">
                      {[
                        ['всего', campaign.recipientCount],
                        ['очередь', campaign.queuedCount],
                        ['API', campaign.acceptedCount],
                        ['искл.', campaign.excludedCount],
                        ['контр.', campaign.holdoutCount],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg bg-white/[0.03] px-1 py-1.5">
                          <p className="text-[11px] font-semibold tabular-nums text-slate-300">{value}</p>
                          <p className="text-[8px] text-slate-600">{label}</p>
                        </div>
                      ))}
                    </div>

                    {evidence && (
                      <>
                        <div className="mt-2 rounded-lg border border-blue-500/15 bg-blue-500/[0.05] px-2 py-1.5 text-[9px] text-blue-300">
                          <p>Предпросмотр: {evidence.previewCount} · очередь {evidence.queuedCount} · контроль {evidence.holdoutCount} · исключено {evidence.excludedCount} · снимок {evidence.approvalSnapshotHash.slice(0, 8)}…{evidence.templateContractHash ? ` · шаблон ${evidence.templateContractHash.slice(0, 8)}…` : ''}</p>
                          {Object.keys(evidence.exclusionReasons).length > 0 && (
                            <p className="mt-1 text-slate-500 text-pretty">
                              Причины: {Object.entries(evidence.exclusionReasons)
                                .map(([reason, count]) => `${exclusionReasonLabel(reason)} — ${count}`)
                                .join('; ')}
                            </p>
                          )}
                        </div>
                        {evidence.recipients.length > 0 && (
                          <details className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                            <summary className="cursor-pointer px-2 py-2 text-[9px] font-medium text-slate-400">
                              Проверить получателей и параметры · {evidence.recipients.length}/{evidence.recipientTotal}
                            </summary>
                            <div className="max-h-72 space-y-1 overflow-y-auto border-t border-white/[0.05] p-2">
                              {evidence.recipients.map((recipient) => (
                                <div key={recipient.id} className="rounded-md border border-white/[0.05] bg-black/15 p-2 text-[9px]">
                                  <div className="flex flex-wrap items-center justify-between gap-1">
                                    <span className="font-mono text-slate-300">{recipient.phoneMasked}</span>
                                    <span className="text-slate-500">
                                      {recipient.state}
                                      {recipient.holdout ? ' · контроль' : ''}
                                    </span>
                                  </div>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">
                                    {recipient.messagePreview ?? 'Сообщение не формируется: получатель исключён или попал в контрольную группу.'}
                                  </p>
                                  <p className="mt-1 break-all font-mono text-[8px] text-slate-600">
                                    Параметры: {recipient.templateParameters.join(' · ') || 'отсутствуют'} · снимок {recipient.templateParametersHash.slice(0, 8)}…
                                  </p>
                                  <p className="mt-1 text-slate-600">
                                    Согласие: {safeRecordText(recipient.consent, 'status')} ·
                                    {' '}{safeRecordText(recipient.consent, 'source')} ·
                                    {' '}{safeRecordText(recipient.consent, 'obtained_at')}
                                  </p>
                                  {(recipient.exclusionReason
                                    || safeRecordStrings(recipient.eligibility, 'exclusions').length > 0) && (
                                    <p className="mt-1 text-amber-400/80">
                                      Исключение: {[
                                        recipient.exclusionReason,
                                        ...safeRecordStrings(recipient.eligibility, 'exclusions'),
                                      ].filter(Boolean).map((reason) =>
                                        exclusionReasonLabel(String(reason)),
                                      ).join(', ')}
                                    </p>
                                  )}
                                </div>
                              ))}
                              {evidence.nextOffset !== null && (
                                <button
                                  type="button"
                                  onClick={() => void loadMoreRecipientPreviews(campaign)}
                                  disabled={mutation !== null || creating}
                                  className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 text-[9px] text-blue-300 disabled:opacity-40"
                                >
                                  <RefreshCw size={11} /> Загрузить ещё
                                </button>
                              )}
                              {evidence.nextOffset === null
                                && evidence.recipients.length === evidence.recipientTotal
                                && campaign.state === 'draft'
                                && !campaign.dryRun && (
                                <button
                                  type="button"
                                  onClick={() => markRecipientPreviewReviewed(campaign)}
                                  disabled={evidence.reviewed || mutation !== null || creating}
                                  className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 text-[9px] text-emerald-300 disabled:opacity-40"
                                >
                                  <ShieldCheck size={11} />
                                  {evidence.reviewed ? 'Просмотр подтверждён' : 'Подтвердить просмотр'}
                                </button>
                              )}
                            </div>
                          </details>
                        )}
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {campaign.state === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void previewCampaign(campaign)}
                          disabled={!canPreview || mutation !== null || creating}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 text-[10px] font-medium text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40"
                        >
                          {rowBusy ? <Loader2 size={12} /> : <Eye size={12} />} Предпросмотр
                        </button>
                      )}
                      {campaign.state === 'draft' && !campaign.dryRun && (
                        <button
                          type="button"
                          onClick={() => openConfirmation('approve', campaign)}
                          disabled={!canApprove || mutation !== null || creating}
                          title={!evidence ? 'Сначала создайте свежий предпросмотр' : undefined}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 text-[10px] font-medium text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-40"
                        >
                          <ShieldCheck size={12} /> Одобрить
                        </button>
                      )}
                      {(campaign.state === 'approved' || campaign.state === 'paused') && (
                        <button
                          type="button"
                          onClick={() => openConfirmation('launch', campaign)}
                          disabled={!canLaunch || mutation !== null || creating}
                          title={!readiness?.send_ready
                            ? 'Cloud API, шаблоны или глобальная отправка не готовы'
                            : !evidence ? 'В этой сессии нет точного снимка предпросмотра' : undefined}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 text-[10px] font-medium text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-40"
                        >
                          <Play size={12} />
                          {campaign.state === 'paused' ? 'Возобновить' : 'Запустить'}
                        </button>
                      )}
                      {campaign.state === 'running' && (
                        <button
                          type="button"
                          onClick={() => openConfirmation('pause', campaign)}
                          disabled={mutation !== null || creating}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 text-[10px] font-medium text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-40"
                        >
                          <Pause size={12} /> Пауза
                        </button>
                      )}
                      {campaign.dryRun && evidence && (
                        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-500/15 bg-slate-500/[0.05] px-2.5 text-[9px] text-slate-400">
                          <CheckCircle2 size={11} /> Тест завершён без отправки
                        </span>
                      )}
                    </div>
                    {campaignErrors[campaign.id] && (
                      <p role="alert" className="mt-2 text-[9px] text-red-300 text-pretty">{campaignErrors[campaign.id]}</p>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={confirmation !== null} onOpenChange={(open) => { if (!open) closeConfirmation() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-xl focus:outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-base font-semibold text-slate-100 text-balance">
                  {confirmation?.kind === 'approve'
                    ? 'Одобрить точный предпросмотр?'
                    : confirmation?.kind === 'launch'
                      ? 'Запустить реальную отправку?'
                      : 'Приостановить кампанию?'}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-xs leading-relaxed text-slate-400 text-pretty">
                  {confirmation?.kind === 'approve'
                    ? 'Это зафиксирует текущую аудиторию и рекомендации, но ещё ничего не отправит.'
                    : confirmation?.kind === 'launch'
                      ? 'Официальные маркетинговые шаблоны будут поставлены в очередь только для получателей, повторно прошедших проверку согласия и лимитов.'
                      : 'Новые задания перестанут запускаться; уже принятые провайдером сообщения нельзя отозвать.'}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={mutation !== null}
                  aria-label="Закрыть подтверждение"
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <p className="truncate text-xs font-semibold text-slate-200">{confirmation?.campaign.name}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                {confirmation ? segmentLabel(confirmation.campaign.segment) : ''}
                {confirmation?.campaign.dryRun ? ' · тестовая' : ' · боевая'}
              </p>
              {confirmation && previewEvidence[confirmation.campaign.id] && (
                <p className="mt-2 font-mono text-[9px] text-slate-500">
                  Снимок: {previewEvidence[confirmation.campaign.id].approvalSnapshotHash.slice(0, 12)}…
                </p>
              )}
            </div>

            <label className="mt-4 block">
              <FieldLabel>Введите фразу точно</FieldLabel>
              <code className="mb-2 block select-all break-all rounded-lg bg-white/[0.04] px-2.5 py-2 text-[10px] text-amber-300">
                {confirmation ? CONFIRMATION_TEXT[confirmation.kind] : ''}
              </code>
              <input
                value={confirmationValue}
                onChange={(event) => setConfirmationValue(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={mutation !== null}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/30 disabled:opacity-40"
              />
            </label>
            {confirmationError && <p role="alert" className="mt-2 text-[10px] text-red-300 text-pretty">{confirmationError}</p>}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={mutation !== null}
                  className="min-h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-medium text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40"
                >
                  Отмена
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void performConfirmedAction()}
                disabled={!confirmation || confirmationValue !== (confirmation ? CONFIRMATION_TEXT[confirmation.kind] : '') || mutation !== null}
                className={cn(
                  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40',
                  confirmation?.kind === 'launch'
                    ? 'border-red-500/25 bg-red-500/15 text-red-300 focus-visible:ring-red-500/50'
                    : confirmation?.kind === 'pause'
                      ? 'border-amber-500/25 bg-amber-500/15 text-amber-300 focus-visible:ring-amber-500/50'
                      : 'border-emerald-500/25 bg-emerald-500/15 text-emerald-300 focus-visible:ring-emerald-500/50',
                )}
              >
                {mutation ? <Loader2 size={14} /> : confirmation?.kind === 'launch' ? <Play size={14} /> : confirmation?.kind === 'pause' ? <Pause size={14} /> : <ShieldCheck size={14} />}
                {mutation ? 'Выполняем…' : confirmation?.kind === 'launch' ? 'Запустить' : confirmation?.kind === 'pause' ? 'Приостановить' : 'Одобрить'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
