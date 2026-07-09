'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { getPersona } from '@/lib/ai/personas/registry'

interface PsychProfile {
  tags: string[]
  recommendedAgent: string
  tone: 'supportive' | 'neutral' | 'direct' | string
  warningsForAi: string[]
}

const TAG_LABELS: Record<string, string> = {
  high_ops_load: 'Высокая операционная нагрузка',
  low_delegation: 'Осторожность в делегировании',
  reflective: 'Рефлексивный подход',
}

const TONE_LABELS: Record<string, { label: string; icon: string }> = {
  supportive: { label: 'Поддерживающий', icon: 'volunteer_activism' },
  neutral: { label: 'Нейтральный', icon: 'balance' },
  direct: { label: 'Прямой', icon: 'bolt' },
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * PsychProfileClient — the business/leadership founder profile (spec 07).
 *
 * Consent-gated: without a `psych_profile` consent it shows a reassuring consent
 * card (explicitly business/leadership, never medical). Granting PUTs the consent
 * then POSTs a compute. With a profile it renders tags, the recommended ГРИ
 * persona, tone and the AI-safety notes reframed as friendly «Что учитывает ГРИ»
 * bullets, plus «Пересчитать» / «Сбросить». All fetches are same-origin.
 */
export default function PsychProfileClient() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [consent, setConsent] = useState(false)
  const [profile, setProfile] = useState<PsychProfile | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/v1/psych-profile', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      if (!data?.ok) throw new Error('not ok')
      setConsent(!!data.consent)
      setProfile((data.profile as PsychProfile | null) ?? null)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const compute = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/v1/psych-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data?.ok && data.profile) {
        setProfile(data.profile as PsychProfile)
        setConsent(true)
        toast.success('Профиль обновлён')
      } else {
        toast.error(data?.message ?? data?.error ?? 'Не удалось рассчитать профиль')
      }
    } catch {
      toast.error('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }, [])

  const grantAndCompute = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/v1/consents', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'psych_profile', granted: true }),
      })
      const data = await res.json()
      if (!data?.ok) {
        toast.error(data?.error ?? 'Не удалось сохранить согласие')
        setBusy(false)
        return
      }
      setConsent(true)
    } catch {
      toast.error('Сеть недоступна. Попробуйте ещё раз.')
      setBusy(false)
      return
    }
    await compute()
  }, [compute])

  const reset = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/v1/psych-profile', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (data?.ok) {
        setProfile(null)
        toast.success('Профиль сброшен')
      } else {
        toast.error(data?.error ?? 'Не удалось сбросить профиль')
      }
    } catch {
      toast.error('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }, [])

  const persona = profile ? getPersona(profile.recommendedAgent) : null
  const tone = profile ? TONE_LABELS[profile.tone] ?? { label: humanize(profile.tone), icon: 'tune' } : null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
          Профиль основателя
        </p>
        <h1 className="font-headline text-2xl md:text-3xl font-extrabold text-on-surface">
          Как ГРИ общается именно с вами
        </h1>
        <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
          Это деловой портрет вашего стиля управления — на основе ваших ответов из анкеты.
          Он помогает ГРИ подобрать тон и приоритеты. Это не медицинская и не психологическая
          оценка, никаких диагнозов.
        </p>
      </div>

      {/* Loading */}
      {status === 'loading' && (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card">
          <Skeleton variant="line" className="h-4 w-1/3 mb-4" />
          <Skeleton variant="block" lines={3} />
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined">cloud_off</span>
            <p className="text-sm">Не удалось загрузить профиль</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon="refresh">
            Повторить
          </Button>
        </div>
      )}

      {/* No consent → consent card */}
      {status === 'ready' && !consent && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-primary/20 bg-surface-container-low p-6 md:p-8 shadow-card"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-primary">shield_person</span>
            </div>
            <div className="flex-1">
              <h2 className="font-headline text-lg font-bold text-on-surface mb-1">
                Персональный портрет — с вашего согласия
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Мы можем собрать деловой портрет вашего лидерского стиля из ответов, которые вы уже
                дали в анкете. ГРИ будет учитывать его, чтобы точнее подбирать формулировки и
                приоритеты.
              </p>

              <ul className="mt-4 space-y-2">
                {[
                  { icon: 'work', text: 'Только бизнес и лидерство — стиль управления, делегирование, фокус.' },
                  { icon: 'medical_services', text: 'Не медицина и не психодиагностика. Никаких диагнозов и ярлыков.' },
                  { icon: 'lock', text: 'Данные видите только вы. Согласие можно отозвать, профиль — удалить.' },
                ].map((row) => (
                  <li key={row.icon} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-base text-primary/80 mt-0.5 flex-shrink-0">
                      {row.icon}
                    </span>
                    {row.text}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Button variant="primary" onClick={() => void grantAndCompute()} loading={busy} leftIcon="check_circle">
                  Согласен и рассчитать
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Consent but no profile yet → compute prompt */}
      {status === 'ready' && consent && !profile && (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <span className="material-symbols-outlined text-primary">psychology</span>
          </div>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-1">Профиль ещё не рассчитан</h2>
          <p className="text-sm text-on-surface-variant mb-5">
            Согласие есть — можно построить портрет из ваших ответов анкеты.
          </p>
          <Button variant="primary" onClick={() => void compute()} loading={busy} leftIcon="auto_awesome">
            Рассчитать профиль
          </Button>
        </div>
      )}

      {/* Profile present */}
      {status === 'ready' && consent && profile && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Recommended persona + tone */}
          <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card">
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-4">
              Ваш режим ГРИ
            </p>
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-2xl">
                {persona?.emoji ?? '⚖️'}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-headline text-lg font-bold text-on-surface">
                  {persona?.name ?? profile.recommendedAgent}
                </h2>
                {persona?.shortDescription && (
                  <p className="text-sm text-on-surface-variant mt-1">{persona.shortDescription}</p>
                )}
                {tone && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-surface-container px-3 py-1.5">
                    <span className="material-symbols-outlined text-base text-primary">{tone.icon}</span>
                    <span className="text-xs text-on-surface-variant">
                      Тон общения: <span className="text-on-surface font-medium">{tone.label}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tags */}
          {profile.tags.length > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card">
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
                Что мы заметили
              </p>
              <div className="flex flex-wrap gap-2">
                {profile.tags.map((t) => (
                  <Badge key={t} variant="primary">
                    {TAG_LABELS[t] ?? humanize(t)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Warnings reframed as friendly "what ГРИ keeps in mind" */}
          {profile.warningsForAi.length > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card">
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
                Что учитывает ГРИ
              </p>
              <ul className="space-y-2.5">
                {profile.warningsForAi.map((w, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-base text-primary mt-0.5 flex-shrink-0">
                      favorite
                    </span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => void compute()} loading={busy} leftIcon="refresh">
              Пересчитать
            </Button>
            <Button variant="danger" size="sm" onClick={() => void reset()} disabled={busy} leftIcon="delete">
              Сбросить
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
