'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import type { FieldValues, UseFormWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import {
  ONBOARDING_STORAGE_VERSION,
  normalizeOnboardingStep,
  onboardingDraftStorageKey,
  resolveOnboardingAnswers,
  resolveOnboardingResumeStep,
  type OnboardingDraft,
} from '@/lib/onboarding-draft'
import Image from 'next/image'
import Link from 'next/link'

// ─── Constants ────────────────────────────────────────────────────────────────
function readLocalDraft(userId?: string | null): OnboardingDraft {
  try {
    const scopedKey = onboardingDraftStorageKey(userId)
    const raw = localStorage.getItem(scopedKey)
      ?? (userId ? localStorage.getItem(onboardingDraftStorageKey()) : null)
    return raw ? JSON.parse(raw) as OnboardingDraft : {}
  } catch {
    return {}
  }
}

interface ApiEnvelope {
  ok?: boolean
  error?: string
  data?: Record<string, unknown> | null
}

async function requireApiSuccess(response: Response): Promise<ApiEnvelope> {
  const payload = await response.json().catch(() => ({})) as ApiEnvelope
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Ошибка сервера (${response.status})`)
  }
  return payload
}

const INDUSTRIES = [
  'IT / Технологии', 'Ритейл / E-commerce', 'Производство', 'Строительство',
  'Финансы / Банкинг', 'Образование', 'Медицина / Здравоохранение',
  'Логистика / Транспорт', 'HoReCa / Рестораны', 'Агробизнес',
  'Консалтинг / Услуги B2B', 'Медиа / Реклама', 'Другое',
]

const REGIONS = [
  'Алматы', 'Астана', 'Шымкент', 'Алматинская область',
  'Карагандинская область', 'Восточный Казахстан', 'Западный Казахстан',
  'Северный Казахстан', 'Россия', 'Другие страны СНГ',
]

const PROMO_CHANNELS = [
  'Instagram', 'Facebook', 'TikTok', 'YouTube', 'Telegram',
  'Google Ads', 'SEO', 'Email-маркетинг', 'Партнёры / Реферальная программа',
  'Холодные звонки', 'Выставки / Мероприятия', 'Сарафанное радио',
]

const MARKETING_CHANNELS = [
  'SMM (соцсети)', 'Контекстная реклама', 'SEO', 'Email-рассылка',
  'Telegram-канал', 'PR / СМИ', 'Партнёрский маркетинг',
  'Influencer-маркетинг', 'Офлайн-реклама',
]

const AUDIENCE_SEGMENTS = [
  'Малый бизнес (SMB)', 'Средний бизнес', 'Крупный бизнес / Корпорации',
  'Государственные структуры', 'Физические лица (B2C)', 'Стартапы',
  'Иностранные компании',
]

const GROWTH_BLOCKERS = [
  'Деньги / Финансирование', 'Команда / Кадры', 'Процессы / Операции',
  'Технологии / IT', 'Рынок / Конкуренция', 'Маркетинг / Продажи',
  'Другое',
]

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const step1Schema = z.object({
  s1_company_name:    z.string().min(2, 'Минимум 2 символа'),
  s1_founded_at:      z.string().min(1, 'Укажите дату основания'),
  s1_industry:        z.string().min(1, 'Выберите отрасль'),
  s1_stage:           z.enum(['Startup','Growth','Scale','Mature']),
  s1_employee_count:  z.coerce.number().min(1, 'Укажите количество сотрудников'),
  s1_regions:         z.array(z.string()).min(1, 'Выберите хотя бы один регион'),
  s1_business_model:  z.enum(['B2B','B2C','B2B2C','Mixed']),
  s1_contact_name:    z.string().min(2, 'Укажите контактное лицо'),
  s1_contact_position:z.string().min(1, 'Укажите должность'),
  s1_contact_phone:   z.string().min(7, 'Укажите телефон'),
  s1_contact_email:   z.string().email('Введите корректный email'),
})

const step2Schema = z.object({
  s2_revenue_2023:       z.coerce.number().min(0),
  s2_revenue_2024:       z.coerce.number().min(0),
  s2_revenue_2025:       z.coerce.number().min(0),
  s2_new_clients_2023:   z.coerce.number().min(0),
  s2_new_clients_2024:   z.coerce.number().min(0),
  s2_new_clients_2025:   z.coerce.number().min(0),
  s2_repeat_clients_2023:z.coerce.number().min(0),
  s2_repeat_clients_2024:z.coerce.number().min(0),
  s2_repeat_clients_2025:z.coerce.number().min(0),
  s2_avg_check:          z.coerce.number().min(0),
  s2_gross_margin:       z.coerce.number().min(0).max(100),
  s2_cac:                z.coerce.number().min(0),
  s2_ltv:                z.coerce.number().min(0),
  s2_debt_load:          z.enum(['none','moderate','high']),
  s2_knows_breakeven:    z.boolean(),
})

const step3Schema = z.object({
  s3_has_crm:            z.enum(['none','excel','amocrm','bitrix24','other']),
  s3_products_description:z.string().min(10, 'Минимум 10 символов'),
  s3_product_count:      z.coerce.number().min(1),
  s3_flagship_product:   z.string().min(1, 'Укажите продукт-локомотив'),
  s3_deals_2023:         z.coerce.number().min(0),
  s3_deals_2024:         z.coerce.number().min(0),
  s3_deals_2025:         z.coerce.number().min(0),
  s3_rejections_2023:    z.coerce.number().min(0),
  s3_rejections_2024:    z.coerce.number().min(0),
  s3_rejections_2025:    z.coerce.number().min(0),
  s3_deal_cycle_days:    z.coerce.number().min(1),
  s3_promo_channels:     z.array(z.string()).min(1, 'Выберите хотя бы один канал'),
  s3_has_loyalty:        z.boolean(),
})

const step4Schema = z.object({
  s4_dept_count:          z.coerce.number().min(1),
  s4_has_org_chart:       z.boolean(),
  s4_management_method:   z.enum(['manual','kpi','okr','hybrid']),
  s4_has_regular_meetings:z.boolean(),
  s4_reporting_tool:      z.enum(['excel','bi','crm','none']),
  s4_task_manager:        z.enum(['none','trello','jira','notion','other']),
  s4_has_dept_kpi:        z.boolean(),
})

const step5Schema = z.object({
  s5_target_audience:        z.string().min(10, 'Минимум 10 символов'),
  s5_audience_segments:      z.array(z.string()).min(1, 'Выберите сегменты'),
  s5_top_regions:            z.array(z.string()).min(1, 'Выберите регионы'),
  s5_marketing_channels:     z.array(z.string()).min(1, 'Выберите каналы'),
  s5_marketing_budget_pct:   z.coerce.number().min(0).max(100),
  s5_has_competitor_analysis:z.boolean(),
  s5_competitor_1:           z.string().optional().default(''),
  s5_competitor_2:           z.string().optional().default(''),
  s5_competitor_3:           z.string().optional().default(''),
  s5_usp:                    z.string().min(10, 'Опишите ваше УТП'),
})

const step6Schema = z.object({
  s6_main_pain:        z.string().min(20, 'Минимум 20 символов'),
  s6_goal_12months:    z.string().min(20, 'Минимум 20 символов'),
  s6_goal_3years:      z.string().min(20, 'Минимум 20 символов'),
  s6_growth_blockers:  z.array(z.string()).min(1, 'Выберите хотя бы один барьер'),
  s6_expectations:     z.string().min(10, 'Минимум 10 символов'),
})

type Step1 = z.infer<typeof step1Schema>
type Step2 = z.infer<typeof step2Schema>
type Step3 = z.infer<typeof step3Schema>
type Step4 = z.infer<typeof step4Schema>
type Step5 = z.infer<typeof step5Schema>
type Step6 = z.infer<typeof step6Schema>

function useDraftAutosave<T extends FieldValues>(
  watch: UseFormWatch<T>,
  onDraft: (values: Record<string, unknown>) => void,
) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const subscription = watch((values) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        onDraft(values as unknown as Record<string, unknown>)
      }, 300)
    })

    return () => {
      if (timer) clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [onDraft, watch])
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
      {children}
    </label>
  )
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-error text-xs mt-1.5">{msg}</p>
}

function TextInput({ name, placeholder, register, error, type = 'text' }: {
  name: string; placeholder?: string; register: any;
  error?: string; type?: string
}) {
  return (
    <div>
      <input
        {...register(name)}
        type={type}
        placeholder={placeholder}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
      />
      <FieldError msg={error} />
    </div>
  )
}

function SelectInput({ name, options, register, error }: {
  name: string; options: { value: string; label: string }[];
  register: any; error?: string
}) {
  return (
    <div>
      <select
        {...register(name)}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
      >
        <option value="">— Выберите —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldError msg={error} />
    </div>
  )
}

function MultiSelect({ label, options, value, onChange, error }: {
  label?: string; options: string[]; value: string[]; onChange: (v: string[]) => void; error?: string
}) {
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              value.includes(opt)
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <FieldError msg={error} />
    </div>
  )
}

function BoolToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between bg-surface-container rounded-xl border border-white/[0.08] px-4 py-3">
      <span className="text-sm text-on-surface">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full transition-all flex items-center px-1 ${value ? 'bg-primary' : 'bg-surface-container-high'}`}
      >
        <span className={`w-4 h-4 rounded-full bg-white transition-all ${value ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

function YearTriple({ base, register, errors, prefix }: {
  base: string; register: any;
  errors: Record<string, { message?: string }>; prefix: string
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {['2023','2024','2025'].map(yr => (
        <div key={yr}>
          <FieldLabel>{yr}</FieldLabel>
          <TextInput name={`${prefix}_${yr}`} type="number" placeholder="0" register={register} error={errors[`${prefix}_${yr}`]?.message} />
        </div>
      ))}
    </div>
  )
}

// ─── Step Titles ──────────────────────────────────────────────────────────────
const STEPS = [
  { n: 1, title: 'Компания',             icon: 'business' },
  { n: 2, title: 'Финансы',              icon: 'payments' },
  { n: 3, title: 'Продажи и CRM',        icon: 'trending_up' },
  { n: 4, title: 'Операции',             icon: 'settings' },
  { n: 5, title: 'Маркетинг',            icon: 'campaign' },
  { n: 6, title: 'Цели и боли',          icon: 'flag' },
]

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>({})
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null)

  // Load the server copy first, then overlay a newer local draft.
  useEffect(() => {
    const bootstrap = async () => {
      let localDraft = readLocalDraft()
      let serverAnswers: Record<string, unknown> = {}
      let serverStep = 1
      let serverSavedAt: string | undefined
      let serverCompanyId: string | null = null

      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        setUserId(user?.id ?? null)
        localDraft = readLocalDraft(user?.id)

        if (user?.id) {
          const [surveyResponse, companyResponse] = await Promise.all([
            fetch(`/api/v1/onboarding/survey?user_id=${encodeURIComponent(user.id)}`),
            fetch(`/api/v1/onboarding/company?user_id=${encodeURIComponent(user.id)}`),
          ])
          const surveyPayload = await requireApiSuccess(surveyResponse)
          const companyPayload = await requireApiSuccess(companyResponse)
          const surveyData = surveyPayload.data
          const companyData = companyPayload.data

          if (surveyData?.answers && typeof surveyData.answers === 'object') {
            serverAnswers = surveyData.answers as Record<string, unknown>
          }
          serverStep = Number(surveyData?.current_step ?? 1)
          if (typeof surveyData?.saved_at === 'string') {
            serverSavedAt = surveyData.saved_at
          }
          if (typeof companyData?.id === 'string') {
            serverCompanyId = companyData.id
          }
        }
      } catch (error) {
        setSyncError(
          `Не удалось загрузить сохранённые ответы с сервера. Локальный черновик доступен; повторите синхронизацию позже.${
            error instanceof Error ? ` ${error.message}` : ''
          }`,
        )
      } finally {
        const resolution = resolveOnboardingAnswers(
          localDraft,
          serverAnswers,
          serverSavedAt,
        )
        setSavedAnswers(resolution.answers)
        setCurrentStep(
          resolution.source === 'server'
            ? normalizeOnboardingStep(serverStep)
            : resolveOnboardingResumeStep(localDraft, serverStep),
        )
        setCompanyId(
          resolution.source === 'server'
            ? serverCompanyId
            : localDraft.company_id ?? serverCompanyId,
        )
        if (resolution.conflict) {
          setRestoreNotice(
            resolution.source === 'server'
              ? 'На сервере найдена более свежая версия анкеты. Открыта она; устаревший локальный черновик не применён.'
              : 'Восстановлен более свежий локальный черновик. Он будет отправлен на сервер при сохранении текущего шага.',
          )
        }
        setIsBootstrapping(false)
      }
    }

    void bootstrap()
  }, [])

  const persistLocal = useCallback((step: number, answers: Record<string, unknown>) => {
    setSavedAnswers((current) => {
      const merged = { ...current, ...answers }
      const existingDraft = readLocalDraft(userId)
      localStorage.setItem(onboardingDraftStorageKey(userId), JSON.stringify({
        version: ONBOARDING_STORAGE_VERSION,
        current_step: step,
        answers: merged,
        company_id: companyId ?? existingDraft.company_id ?? null,
        saved_at: new Date().toISOString(),
      }))
      if (userId) localStorage.removeItem(onboardingDraftStorageKey())
      return merged
    })
  }, [companyId, userId])

  const persistCurrentDraft = useCallback((answers: Record<string, unknown>) => {
    persistLocal(currentStep, answers)
  }, [currentStep, persistLocal])

  const saveToServer = async (
    step: number,
    answers: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!userId) {
      setSyncError('Сессия пользователя не загрузилась. Черновик сохранён локально; войдите снова и повторите.')
      return false
    }

    setIsSaving(true)
    setSyncError(null)
    try {
      let resolvedCompanyId = companyId

      // If step 1, also create/update company record
      if (step === 1) {
        const compRes = await fetch('/api/v1/onboarding/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            name: answers['s1_company_name'],
            industry: answers['s1_industry'],
            stage: answers['s1_stage'],
            employee_count: answers['s1_employee_count'],
            founded_at: answers['s1_founded_at'],
            business_model: answers['s1_business_model'],
            regions: answers['s1_regions'],
            contact_name: answers['s1_contact_name'],
            contact_position: answers['s1_contact_position'],
            contact_phone: answers['s1_contact_phone'],
            contact_email: answers['s1_contact_email'],
          }),
        })
        const compData = await requireApiSuccess(compRes)
        const createdCompanyId = compData.data?.id
        if (typeof createdCompanyId !== 'string') {
          throw new Error('Сервер не вернул идентификатор компании')
        }
        resolvedCompanyId = createdCompanyId
        setCompanyId(createdCompanyId)
        const localDraft = readLocalDraft(userId)
        localStorage.setItem(onboardingDraftStorageKey(userId), JSON.stringify({
          ...localDraft,
          version: ONBOARDING_STORAGE_VERSION,
          company_id: createdCompanyId,
          saved_at: new Date().toISOString(),
        }))
        localStorage.removeItem(onboardingDraftStorageKey())
      }

      // Save survey answers
      const formatted: Record<string, { value: unknown }> = {}
      for (const [k, v] of Object.entries(answers)) {
        formatted[k] = { value: v }
      }
      const surveyResponse = await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, company_id: resolvedCompanyId, step, answers: formatted }),
      })
      await requireApiSuccess(surveyResponse)
      return true
    } catch (error) {
      setSyncError(
        `Ответы сохранены локально, но сервер их не подтвердил. Проверьте соединение и повторно нажмите текущую кнопку. ${
          error instanceof Error ? error.message : ''
        }`,
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const goNext = async (step: number, data: Record<string, unknown>) => {
    if (isSaving) return
    persistLocal(step, data)
    const saved = await saveToServer(step, data)
    if (!saved) return

    if (step < 6) {
      const nextStep = step + 1
      persistLocal(nextStep, data)
      setCurrentStep(nextStep)
    } else {
      // All done — trigger Point A calculation
      setIsSaving(true)
      try {
        const diagnosticResponse = await fetch('/api/v1/diagnostics/recalculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        })
        await requireApiSuccess(diagnosticResponse)
        localStorage.removeItem(onboardingDraftStorageKey(userId))
        localStorage.removeItem(onboardingDraftStorageKey())
        router.replace('/client/dashboard?onboarding=complete')
      } catch (error) {
        setSyncError(
          `Анкета сохранена, но диагностика пока не рассчитана. Черновик оставлен — повторите запуск. ${
            error instanceof Error ? error.message : ''
          }`,
        )
      } finally {
        setIsSaving(false)
      }
    }
  }

  const goBack = () => {
    if (isSaving) return
    const previousStep = Math.max(1, currentStep - 1)
    persistLocal(previousStep, {})
    setCurrentStep(previousStep)
  }

  const progress = Math.round((currentStep / 6) * 100)

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#0A0B0F] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Восстанавливаем анкету...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/client/dashboard" aria-label="Вернуться в обзор">
            <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          </Link>
          <div className="flex items-center gap-4">
            {isSaving && (
              <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                <span className="w-3 h-3 border border-primary/50 border-t-primary rounded-full animate-spin" />
                Сохранение...
              </div>
            )}
            <span className="text-xs font-mono text-on-surface-variant">
              Шаг {currentStep} из 6
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="max-w-2xl mx-auto mt-3">
          <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-[#00e29e] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step tabs */}
        <div className="max-w-2xl mx-auto mt-3 flex gap-1 overflow-x-auto scrollbar-hide">
          {STEPS.map(s => (
            <button
              key={s.n}
              onClick={() => {
                if (isSaving || s.n >= currentStep) return
                persistLocal(s.n, {})
                setCurrentStep(s.n)
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap transition-all ${
                s.n === currentStep
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : s.n < currentStep
                  ? 'text-primary/60 hover:text-primary cursor-pointer'
                  : 'text-on-surface-variant/40 cursor-not-allowed'
              }`}
              disabled={isSaving || s.n > currentStep}
            >
              {s.n < currentStep ? (
                <span className="material-symbols-outlined text-xs">check</span>
              ) : (
                <span className="material-symbols-outlined text-xs">{s.icon}</span>
              )}
              {s.title}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 py-8">
        {syncError && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-error/25 bg-error/10 px-4 py-3"
          >
            <span className="material-symbols-outlined mt-0.5 text-lg text-error">cloud_off</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-error">Синхронизация не завершена</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{syncError}</p>
            </div>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              className="text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label="Закрыть сообщение"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        )}
        {restoreNotice && (
          <div
            role="status"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/10 px-4 py-3"
          >
            <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">history</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-on-surface">Версия анкеты восстановлена</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{restoreNotice}</p>
            </div>
            <button
              type="button"
              onClick={() => setRestoreNotice(null)}
              className="text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label="Закрыть сообщение"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        )}
        {currentStep === 1 && (
          <Step1Form
            defaultValues={savedAnswers}
            onNext={(data) => goNext(1, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
        {currentStep === 2 && (
          <Step2Form
            defaultValues={savedAnswers}
            onBack={goBack}
            onNext={(data) => goNext(2, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
        {currentStep === 3 && (
          <Step3Form
            defaultValues={savedAnswers}
            onBack={goBack}
            onNext={(data) => goNext(3, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
        {currentStep === 4 && (
          <Step4Form
            defaultValues={savedAnswers}
            onBack={goBack}
            onNext={(data) => goNext(4, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
        {currentStep === 5 && (
          <Step5Form
            defaultValues={savedAnswers}
            onBack={goBack}
            onNext={(data) => goNext(5, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
        {currentStep === 6 && (
          <Step6Form
            defaultValues={savedAnswers}
            onBack={goBack}
            onNext={(data) => goNext(6, data)}
            onDraft={persistCurrentDraft}
            isSaving={isSaving}
          />
        )}
      </main>
    </div>
  )
}

// ─── Navigation Buttons ───────────────────────────────────────────────────────
function NavButtons({ onBack, nextLabel = 'Далее', isLast = false, loading = false }: {
  onBack?: () => void; nextLabel?: string; isLast?: boolean; loading?: boolean
}) {
  return (
    <div className="flex gap-3 mt-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="px-6 py-3 rounded-xl border border-white/[0.08] text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Назад
        </button>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm flex items-center justify-center gap-2 hover:scale-[0.99] transition-all disabled:opacity-60"
      >
        {loading ? (
          <><span className="w-4 h-4 border-2 border-[#003824]/30 border-t-[#003824] rounded-full animate-spin" />Обработка...</>
        ) : (
          <>{isLast ? '🚀 ' : ''}{nextLabel}{!isLast && ' →'}</>
        )}
      </button>
    </div>
  )
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
        Шаг {step} из 6
      </p>
      <h2 className="font-headline text-2xl font-extrabold text-on-surface mb-1">{title}</h2>
      <p className="text-sm text-on-surface-variant">{subtitle}</p>
    </div>
  )
}

// ─── STEP 1: Company ──────────────────────────────────────────────────────────
function Step1Form({ defaultValues, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: defaultValues as Partial<Step1>,
  })
  useDraftAutosave(watch, onDraft)
  const regions = (watch('s1_regions') as string[]) ?? []

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-5">
      <StepHeader step={1} title="О компании" subtitle="Расскажите о вашем бизнесе — это основа вашей диагностики" />

      <div>
        <FieldLabel>Название компании *</FieldLabel>
        <TextInput name="s1_company_name" placeholder="ТОО Алмас / АО КомпанияXX" register={register} error={errors.s1_company_name?.message} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Дата основания *</FieldLabel>
          <TextInput name="s1_founded_at" type="date" register={register} error={errors.s1_founded_at?.message} />
        </div>
        <div>
          <FieldLabel>Количество сотрудников *</FieldLabel>
          <TextInput name="s1_employee_count" type="number" placeholder="45" register={register} error={errors.s1_employee_count?.message} />
        </div>
      </div>

      <div>
        <FieldLabel>Отрасль *</FieldLabel>
        <SelectInput name="s1_industry" options={INDUSTRIES.map(i => ({ value: i, label: i }))} register={register} error={errors.s1_industry?.message} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Стадия развития *</FieldLabel>
          <SelectInput name="s1_stage" options={[
            { value: 'Startup', label: 'Startup' },
            { value: 'Growth', label: 'Growth' },
            { value: 'Scale', label: 'Scale' },
            { value: 'Mature', label: 'Mature' },
          ]} register={register} error={errors.s1_stage?.message} />
        </div>
        <div>
          <FieldLabel>Бизнес-модель *</FieldLabel>
          <SelectInput name="s1_business_model" options={[
            { value: 'B2B', label: 'B2B' },
            { value: 'B2C', label: 'B2C' },
            { value: 'B2B2C', label: 'B2B2C' },
            { value: 'Mixed', label: 'Mixed' },
          ]} register={register} error={errors.s1_business_model?.message} />
        </div>
      </div>

      <div>
        <FieldLabel>География присутствия *</FieldLabel>
        <MultiSelect
          options={REGIONS}
          value={regions}
          onChange={v => setValue('s1_regions', v, { shouldValidate: true })}
          error={errors.s1_regions?.message}
        />
      </div>

      <div className="border-t border-white/[0.06] pt-5">
        <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-4">Контактное лицо</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>ФИО *</FieldLabel>
            <TextInput name="s1_contact_name" placeholder="Иван Иванов" register={register} error={errors.s1_contact_name?.message} />
          </div>
          <div>
            <FieldLabel>Должность *</FieldLabel>
            <TextInput name="s1_contact_position" placeholder="CEO / CFO" register={register} error={errors.s1_contact_position?.message} />
          </div>
          <div>
            <FieldLabel>Телефон *</FieldLabel>
            <TextInput name="s1_contact_phone" placeholder="+7 777 000 00 00" register={register} error={errors.s1_contact_phone?.message} />
          </div>
          <div>
            <FieldLabel>Email *</FieldLabel>
            <TextInput name="s1_contact_email" type="email" placeholder="ceo@company.kz" register={register} error={errors.s1_contact_email?.message} />
          </div>
        </div>
      </div>

      <NavButtons nextLabel="Далее — Финансы" loading={isSaving} />
    </form>
  )
}

// ─── STEP 2: Finance ──────────────────────────────────────────────────────────
function Step2Form({ defaultValues, onBack, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>
  onBack: () => void
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step2>({
    resolver: zodResolver(step2Schema),
    defaultValues: defaultValues as Partial<Step2>,
  })
  useDraftAutosave(watch, onDraft)
  const knowsBE = watch('s2_knows_breakeven') ?? false
  const debt = watch('s2_debt_load')

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-6">
      <StepHeader step={2} title="Финансы" subtitle="Ключевые финансовые показатели вашего бизнеса" />

      <div>
        <FieldLabel>Выручка (₸) — по годам</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {['2023','2024','2025'].map(yr => (
            <div key={yr}>
              <p className="text-xs text-on-surface-variant mb-1.5">{yr}</p>
              <input {...register(`s2_revenue_${yr}` as keyof Step2)} type="number" placeholder="0"
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Новых клиентов — по годам</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {['2023','2024','2025'].map(yr => (
            <div key={yr}>
              <p className="text-xs text-on-surface-variant mb-1.5">{yr}</p>
              <input {...register(`s2_new_clients_${yr}` as keyof Step2)} type="number" placeholder="0"
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Повторных клиентов — по годам</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {['2023','2024','2025'].map(yr => (
            <div key={yr}>
              <p className="text-xs text-on-surface-variant mb-1.5">{yr}</p>
              <input {...register(`s2_repeat_clients_${yr}` as keyof Step2)} type="number" placeholder="0"
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Средний чек (₸) *</FieldLabel>
          <TextInput name="s2_avg_check" type="number" placeholder="50000" register={register} error={errors.s2_avg_check?.message} />
        </div>
        <div>
          <FieldLabel>Маржинальность (%)</FieldLabel>
          <TextInput name="s2_gross_margin" type="number" placeholder="34" register={register} error={errors.s2_gross_margin?.message} />
        </div>
        <div>
          <FieldLabel>CAC — стоимость клиента (₸)</FieldLabel>
          <TextInput name="s2_cac" type="number" placeholder="15000" register={register} error={errors.s2_cac?.message} />
        </div>
        <div>
          <FieldLabel>LTV — ценность клиента (₸)</FieldLabel>
          <TextInput name="s2_ltv" type="number" placeholder="90000" register={register} error={errors.s2_ltv?.message} />
        </div>
      </div>

      <div>
        <FieldLabel>Долговая нагрузка *</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          {([['none','Нет'],['moderate','Умеренная'],['high','Высокая']] as const).map(([v, l]) => (
            <button key={v} type="button"
              onClick={() => setValue('s2_debt_load', v, { shouldValidate: true })}
              className={`py-2.5 rounded-xl text-sm border transition-all ${debt === v ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <BoolToggle
        label="Компания знает точку безубыточности?"
        value={knowsBE}
        onChange={v => setValue('s2_knows_breakeven', v)}
      />

      <NavButtons onBack={onBack} nextLabel="Далее — Продажи" loading={isSaving} />
    </form>
  )
}

// ─── STEP 3: Sales & CRM ──────────────────────────────────────────────────────
function Step3Form({ defaultValues, onBack, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>
  onBack: () => void
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step3>({
    resolver: zodResolver(step3Schema),
    defaultValues: defaultValues as Partial<Step3>,
  })
  useDraftAutosave(watch, onDraft)
  const channels = (watch('s3_promo_channels') as string[]) ?? []
  const hasLoyalty = watch('s3_has_loyalty') ?? false

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-5">
      <StepHeader step={3} title="Продажи и CRM" subtitle="Ваша воронка продаж и инструменты управления клиентами" />

      <div>
        <FieldLabel>Есть ли CRM-система? *</FieldLabel>
        <SelectInput name="s3_has_crm" options={[
          { value: 'none', label: 'Нет CRM' },
          { value: 'excel', label: 'Excel / Google Sheets' },
          { value: 'amocrm', label: 'amoCRM' },
          { value: 'bitrix24', label: 'Bitrix24' },
          { value: 'other', label: 'Другое' },
        ]} register={register} error={errors.s3_has_crm?.message} />
      </div>

      <div>
        <FieldLabel>Описание продуктов/услуг *</FieldLabel>
        <textarea {...register('s3_products_description')} rows={3} placeholder="Что именно вы продаёте..."
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s3_products_description?.message} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Количество продуктов *</FieldLabel>
          <TextInput name="s3_product_count" type="number" placeholder="5" register={register} error={errors.s3_product_count?.message} />
        </div>
        <div>
          <FieldLabel>Продукт-локомотив *</FieldLabel>
          <TextInput name="s3_flagship_product" placeholder="Название главного продукта" register={register} error={errors.s3_flagship_product?.message} />
        </div>
      </div>

      <div>
        <FieldLabel>Количество сделок в воронке — по годам</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {['2023','2024','2025'].map(yr => (
            <div key={yr}>
              <p className="text-xs text-on-surface-variant mb-1.5">{yr}</p>
              <input {...register(`s3_deals_${yr}` as keyof Step3)} type="number" placeholder="0"
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Количество отказов — по годам</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {['2023','2024','2025'].map(yr => (
            <div key={yr}>
              <p className="text-xs text-on-surface-variant mb-1.5">{yr}</p>
              <input {...register(`s3_rejections_${yr}` as keyof Step3)} type="number" placeholder="0"
                className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Цикл сделки (дней) *</FieldLabel>
        <TextInput name="s3_deal_cycle_days" type="number" placeholder="30" register={register} error={errors.s3_deal_cycle_days?.message} />
      </div>

      <div>
        <FieldLabel>Каналы продвижения *</FieldLabel>
        <MultiSelect
          options={PROMO_CHANNELS}
          value={channels}
          onChange={v => setValue('s3_promo_channels', v, { shouldValidate: true })}
          error={errors.s3_promo_channels?.message}
        />
      </div>

      <BoolToggle
        label="Есть программа лояльности?"
        value={hasLoyalty}
        onChange={v => setValue('s3_has_loyalty', v)}
      />

      <NavButtons onBack={onBack} nextLabel="Далее — Операции" loading={isSaving} />
    </form>
  )
}

// ─── STEP 4: Operations ───────────────────────────────────────────────────────
function Step4Form({ defaultValues, onBack, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>
  onBack: () => void
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step4>({
    resolver: zodResolver(step4Schema),
    defaultValues: defaultValues as Partial<Step4>,
  })
  useDraftAutosave(watch, onDraft)
  const hasOrgChart = watch('s4_has_org_chart') ?? false
  const hasMeetings = watch('s4_has_regular_meetings') ?? false
  const hasDeptKPI = watch('s4_has_dept_kpi') ?? false

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-5">
      <StepHeader step={4} title="Операции и управление" subtitle="Как устроены процессы и управление внутри компании" />

      <div>
        <FieldLabel>Количество отделов *</FieldLabel>
        <TextInput name="s4_dept_count" type="number" placeholder="5" register={register} error={errors.s4_dept_count?.message} />
      </div>

      <div className="space-y-3">
        <BoolToggle label="Есть оргструктура (схема)?" value={hasOrgChart} onChange={v => setValue('s4_has_org_chart', v)} />
        <BoolToggle label="Проводятся регулярные собрания с повесткой?" value={hasMeetings} onChange={v => setValue('s4_has_regular_meetings', v)} />
        <BoolToggle label="KPI установлены у каждого отдела?" value={hasDeptKPI} onChange={v => setValue('s4_has_dept_kpi', v)} />
      </div>

      <div>
        <FieldLabel>Метод управления *</FieldLabel>
        <SelectInput name="s4_management_method" options={[
          { value: 'manual', label: 'Ручное управление' },
          { value: 'kpi', label: 'По KPI' },
          { value: 'okr', label: 'OKR' },
          { value: 'hybrid', label: 'Гибридное' },
        ]} register={register} error={errors.s4_management_method?.message} />
      </div>

      <div>
        <FieldLabel>Как ведётся отчётность *</FieldLabel>
        <SelectInput name="s4_reporting_tool" options={[
          { value: 'none', label: 'Нет' },
          { value: 'excel', label: 'Excel / Google Sheets' },
          { value: 'bi', label: 'BI-система (Power BI, Tableau)' },
          { value: 'crm', label: 'CRM-отчёты' },
        ]} register={register} error={errors.s4_reporting_tool?.message} />
      </div>

      <div>
        <FieldLabel>Таск-менеджер *</FieldLabel>
        <SelectInput name="s4_task_manager" options={[
          { value: 'none', label: 'Не используется' },
          { value: 'trello', label: 'Trello' },
          { value: 'jira', label: 'Jira' },
          { value: 'notion', label: 'Notion' },
          { value: 'other', label: 'Другое' },
        ]} register={register} error={errors.s4_task_manager?.message} />
      </div>

      <NavButtons onBack={onBack} nextLabel="Далее — Маркетинг" loading={isSaving} />
    </form>
  )
}

// ─── STEP 5: Marketing ───────────────────────────────────────────────────────
function Step5Form({ defaultValues, onBack, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>
  onBack: () => void
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step5>({
    resolver: zodResolver(step5Schema),
    defaultValues: defaultValues as Partial<Step5>,
  })
  useDraftAutosave(watch, onDraft)
  const segments = (watch('s5_audience_segments') as string[]) ?? []
  const topRegions = (watch('s5_top_regions') as string[]) ?? []
  const mktChannels = (watch('s5_marketing_channels') as string[]) ?? []
  const hasCA = watch('s5_has_competitor_analysis') ?? false

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-5">
      <StepHeader step={5} title="Маркетинг и клиенты" subtitle="Ваша аудитория, каналы и позиционирование на рынке" />

      <div>
        <FieldLabel>Целевая аудитория *</FieldLabel>
        <textarea {...register('s5_target_audience')} rows={3}
          placeholder="Опишите вашего идеального клиента: кто он, какие у него боли..."
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s5_target_audience?.message} />
      </div>

      <div>
        <FieldLabel>Сегменты ЦА *</FieldLabel>
        <MultiSelect
          options={AUDIENCE_SEGMENTS}
          value={segments}
          onChange={v => setValue('s5_audience_segments', v, { shouldValidate: true })}
          error={errors.s5_audience_segments?.message}
        />
      </div>

      <div>
        <FieldLabel>Топ регионы по выручке *</FieldLabel>
        <MultiSelect
          options={REGIONS}
          value={topRegions}
          onChange={v => setValue('s5_top_regions', v, { shouldValidate: true })}
          error={errors.s5_top_regions?.message}
        />
      </div>

      <div>
        <FieldLabel>Основные каналы маркетинга *</FieldLabel>
        <MultiSelect
          options={MARKETING_CHANNELS}
          value={mktChannels}
          onChange={v => setValue('s5_marketing_channels', v, { shouldValidate: true })}
          error={errors.s5_marketing_channels?.message}
        />
      </div>

      <div>
        <FieldLabel>Маркетинговый бюджет (% от выручки)</FieldLabel>
        <TextInput name="s5_marketing_budget_pct" type="number" placeholder="5" register={register} error={errors.s5_marketing_budget_pct?.message} />
      </div>

      <BoolToggle
        label="Проводился конкурентный анализ?"
        value={hasCA}
        onChange={v => setValue('s5_has_competitor_analysis', v)}
      />

      <div>
        <FieldLabel>Топ-3 конкурента</FieldLabel>
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <input key={i} {...register(`s5_competitor_${i}` as keyof Step5)} placeholder={`Конкурент ${i}`}
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Позиционирование / УТП *</FieldLabel>
        <textarea {...register('s5_usp')} rows={3}
          placeholder="Почему клиенты выбирают вас? В чём ваше уникальное преимущество?"
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s5_usp?.message} />
      </div>

      <NavButtons onBack={onBack} nextLabel="Далее — Цели" loading={isSaving} />
    </form>
  )
}

// ─── STEP 6: Goals & Pain ─────────────────────────────────────────────────────
function Step6Form({ defaultValues, onBack, onNext, onDraft, isSaving }: {
  defaultValues: Record<string, unknown>; onBack: () => void;
  onNext: (d: Record<string, unknown>) => void
  onDraft: (d: Record<string, unknown>) => void
  isSaving: boolean
}) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Step6>({
    resolver: zodResolver(step6Schema),
    defaultValues: defaultValues as Partial<Step6>,
  })
  useDraftAutosave(watch, onDraft)
  const blockers = (watch('s6_growth_blockers') as string[]) ?? []

  return (
    <form onSubmit={handleSubmit(data => onNext(data as Record<string, unknown>))} className="space-y-5">
      <StepHeader step={6} title="Цели и боли" subtitle="Последний шаг — самый важный. Расскажите о ваших целях и проблемах" />

      <div>
        <FieldLabel>Главная проблема / боль бизнеса *</FieldLabel>
        <textarea {...register('s6_main_pain')} rows={4}
          placeholder="Что сейчас больше всего мешает вашему бизнесу? Опишите конкретно..."
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s6_main_pain?.message} />
      </div>

      <div>
        <FieldLabel>Цель на 12 месяцев (SMART) *</FieldLabel>
        <textarea {...register('s6_goal_12months')} rows={3}
          placeholder="Конкретная, измеримая цель. Например: вырасти до ₸200 млн выручки к Q4 2025..."
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s6_goal_12months?.message} />
      </div>

      <div>
        <FieldLabel>Цель на 3 года *</FieldLabel>
        <textarea {...register('s6_goal_3years')} rows={3}
          placeholder="Каким вы видите бизнес через 3 года?"
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s6_goal_3years?.message} />
      </div>

      <div>
        <FieldLabel>Что мешает расти? *</FieldLabel>
        <MultiSelect
          options={GROWTH_BLOCKERS}
          value={blockers}
          onChange={v => setValue('s6_growth_blockers', v, { shouldValidate: true })}
          error={errors.s6_growth_blockers?.message}
        />
      </div>

      <div>
        <FieldLabel>Чего ожидаете от диагностики? *</FieldLabel>
        <textarea {...register('s6_expectations')} rows={3}
          placeholder="Что хотите получить в результате работы с AIStart360?"
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none" />
        <FieldError msg={errors.s6_expectations?.message} />
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-xl flex-shrink-0 mt-0.5">auto_awesome</span>
          <div>
            <p className="text-sm font-medium text-on-surface mb-1">Готово к анализу</p>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              После отправки AI-система рассчитает ваш Индекс Здоровья Бизнеса и подготовит персональный отчёт Point A.
            </p>
          </div>
        </div>
      </div>

      <NavButtons onBack={onBack} nextLabel="Получить диагностику" isLast loading={isSaving} />
    </form>
  )
}
