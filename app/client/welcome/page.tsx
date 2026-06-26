'use client'

// Welcome screen — shown once after registration/first login. Lets the user
// pick which vertical their business is ("general B2B" or "clinic") so the
// rest of the onboarding / cabinet is tailored. Default: generic.
//
// Skip logic:
// 1. URL param ?vertical=<id> → auto-apply + go straight to onboarding
// 2. Profile already has vertical != 'generic' → skip
// (Both handled in useEffect below.)

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { VERTICALS, isValidVerticalId, type VerticalId } from '@/lib/verticals'

// Route each vertical sends the user to after selection (anketa path)
const ANKETA_ROUTE: Record<VerticalId, string> = {
  generic:   '/client/onboarding',
  medical:   '/client/onboarding-medical',
  ecommerce: '/client/onboarding-ecommerce',
}

type Step = 'vertical' | 'path'

export default function WelcomePage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<VerticalId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('vertical')
  const [chosenVertical, setChosenVertical] = useState<VerticalId | null>(null)

  const applyVertical = useCallback(
    async (vertical: VerticalId, advance = true): Promise<boolean> => {
      setApplying(vertical)
      setError(null)
      try {
        const res = await fetch('/api/v1/organizations/set-vertical', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vertical }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        setChosenVertical(vertical)
        if (advance) {
          setStep('path')
          setApplying(null)
        }
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
        setApplying(null)
        return false
      }
    },
    [],
  )

  // Bootstrap: check if we should skip the picker entirely
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // 1. URL param override → set vertical + go straight to path picker
        const urlVertical = searchParams.get('vertical')
        if (urlVertical && isValidVerticalId(urlVertical)) {
          await applyVertical(urlVertical, true)
          setLoading(false)
          return
        }

        // 2. Read current vertical from profiles + check onboarding completion
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.replace('/login')
          return
        }
        const [profileRes, companyRes] = await Promise.all([
          supabase.from('profiles').select('vertical').eq('id', user.id).maybeSingle(),
          supabase.from('companies').select('id').eq('user_id', user.id).limit(1),
        ])
        if (cancelled) return

        // 2a. Onboarding already done → straight to dashboard (existing users)
        if (companyRes.data && companyRes.data.length > 0) {
          router.replace('/dashboard')
          return
        }

        // 2b. Non-default vertical already set → jump directly to path picker
        const v = profileRes.data?.vertical
        if (v && isValidVerticalId(v) && v !== 'generic') {
          setChosenVertical(v)
          setStep('path')
          setLoading(false)
          return
        }

        // 2c. Fresh user with default vertical → show vertical picker
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Ошибка загрузки')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [searchParams, router, applyVertical])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          Загрузка...
        </div>
      </div>
    )
  }

  // ── Step 2: path picker (anketa / files / dashboard) ──
  if (step === 'path') {
    const anketaHref = chosenVertical ? ANKETA_ROUTE[chosenVertical] : '/client/onboarding'
    const verticalLabel = chosenVertical
      ? VERTICALS.find((v) => v.id === chosenVertical)?.label ?? ''
      : ''
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-8">
            <button
              type="button"
              onClick={() => setStep('vertical')}
              className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary mb-4"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              Изменить тип бизнеса
            </button>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
              AIStart360 · {verticalLabel}
            </p>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
              Как начнём?
            </h1>
            <p className="text-on-surface-variant mt-3 max-w-lg mx-auto text-sm">
              Выберите путь — все три ведут к одному дашборду. Можно потом сделать остальные.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Path 1: anketa */}
            <button
              type="button"
              onClick={() => router.replace(anketaHref)}
              className="group text-left bg-surface-container-low rounded-2xl border border-white/[0.06] hover:border-primary/40 hover:bg-primary/5 transition-all p-5"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center mb-3 group-hover:bg-primary/25 transition-colors">
                <span className="material-symbols-outlined text-primary text-xl">edit_document</span>
              </div>
              <h3 className="font-headline text-base font-bold text-on-surface mb-1">Заполню анкету</h3>
              <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                ~3-5 минут. Ответите на вопросы о бизнесе → AI рассчитает Точку А и базовый GRI.
              </p>
              <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                Перейти к анкете
                <span className="material-symbols-outlined text-[14px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </span>
            </button>

            {/* Path 2: files */}
            <button
              type="button"
              onClick={() => router.replace('/client/onboarding/documents')}
              className="group text-left bg-surface-container-low rounded-2xl border border-white/[0.06] hover:border-blue-500/40 hover:bg-blue-500/5 transition-all p-5 relative overflow-hidden"
            >
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                ⚡ Быстрее
              </span>
              <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center mb-3 group-hover:bg-blue-500/25 transition-colors">
                <span className="material-symbols-outlined text-blue-300 text-xl">cloud_upload</span>
              </div>
              <h3 className="font-headline text-base font-bold text-on-surface mb-1">Загружу файлы</h3>
              <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                P&L, CRM, базу клиентов, что есть. AI сам определит типы и разложит по блокам.
              </p>
              <span className="inline-flex items-center gap-1 text-xs text-blue-300 font-medium">
                AI-загрузка
                <span className="material-symbols-outlined text-[14px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </span>
            </button>

            {/* Path 3: dashboard — full sidebar cabinet (shared (dashboard) layout) */}
            <button
              type="button"
              onClick={() => router.replace('/dashboard')}
              className="group text-left bg-surface-container-low rounded-2xl border border-white/[0.06] hover:border-purple-500/40 hover:bg-purple-500/5 transition-all p-5"
            >
              <div className="w-11 h-11 rounded-xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center mb-3 group-hover:bg-purple-500/25 transition-colors">
                <span className="material-symbols-outlined text-purple-300 text-xl">dashboard</span>
              </div>
              <h3 className="font-headline text-base font-bold text-on-surface mb-1">Просто посмотрю</h3>
              <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                Открыть пустой дашборд. Заполнить данные в любой момент позже из меню.
              </p>
              <span className="inline-flex items-center gap-1 text-xs text-purple-300 font-medium">
                Открыть дашборд
                <span className="material-symbols-outlined text-[14px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </span>
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-xl bg-error/5 border border-error/20 p-4 text-sm text-error text-center">
              {error}
            </div>
          )}

          <p className="text-center text-[11px] text-on-surface-variant/60 mt-8">
            💡 Совет: «Загрузка файлов» даёт самые точные метрики. Можно начать с неё и потом дозаполнить анкету.
          </p>
        </div>
      </div>
    )
  }

  // ── Step 1: vertical picker (default first step) ──
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-10">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            AIStart360 · Шаг 1 из 2
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
            С чем работаем?
          </h1>
          <p className="text-on-surface-variant mt-3 max-w-lg mx-auto text-sm">
            Выберите тип вашего бизнеса — интерфейс и анкета подстроятся под него.
            Поменять можно позже в настройках профиля.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {VERTICALS.map((v) => {
            const isApplying = applying === v.id
            return (
              <button
                key={v.id}
                onClick={() => applyVertical(v.id)}
                disabled={applying !== null}
                className={`group relative text-left bg-surface-container-low rounded-2xl border border-white/[0.06] hover:border-primary/40 hover:bg-primary/5 transition-all p-6 disabled:opacity-60 disabled:cursor-wait`}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-primary text-2xl">
                      {v.icon}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-headline text-lg font-bold text-on-surface">
                      {v.label}
                    </h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {v.subtitle}
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 mb-5">
                  {v.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm text-on-surface"
                    >
                      <span className="material-symbols-outlined text-primary/70 text-sm mt-0.5 flex-shrink-0">
                        check
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant italic line-clamp-2">
                    {v.description}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg bg-primary text-on-primary text-sm font-medium px-3 py-1.5 flex-shrink-0 ml-3 ${
                      isApplying ? 'opacity-75' : 'group-hover:bg-primary/90'
                    }`}
                  >
                    {isApplying ? (
                      <span className="material-symbols-outlined text-base animate-spin">
                        progress_activity
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-base">
                        arrow_forward
                      </span>
                    )}
                    {isApplying ? 'Настраиваем...' : 'Выбрать'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <div className="mt-6 rounded-xl bg-error/5 border border-error/20 p-4 text-sm text-error text-center">
            {error}
          </div>
        )}

        <p className="text-center text-[11px] text-on-surface-variant/60 mt-10">
          💡 Не уверены? Выберите любой вариант — всегда можно изменить в настройках профиля.
        </p>
      </div>
    </div>
  )
}
