'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
// recharts is heavy — load the radar lazily so it stays out of the gri-free
// first-load JS (it only renders on the result step).
const MiniGriRadar = dynamic(() => import('./MiniGriRadar'), {
  ssr: false,
  loading: () => <div className="h-full w-full skeleton rounded-xl" />,
})
import {
  computeMiniGri,
  zoneForScore,
  type MiniGriAnswers,
  type MiniGriResult,
  type MiniGriZone,
} from '@/lib/gri/mini'

// ─────────────────────────────────────────────────────────────────────────────
// Step definitions — 6 quick questions
// ─────────────────────────────────────────────────────────────────────────────

type StepKey = keyof MiniGriAnswers

interface SliderStep {
  kind: 'slider'
  key: Extract<StepKey, 'margin' | 'ltvCacRatio' | 'runwayMonths' | 'conversionRate'>
  block: string
  question: string
  hint: string
  min: number
  max: number
  step: number
  unit: string
  format?: (v: number) => string
}

interface ToggleStep {
  kind: 'toggle'
  key: Extract<StepKey, 'hasScripts' | 'steadyDemand'>
  block: string
  question: string
  hint: string
  yes: string
  no: string
}

type Step = SliderStep | ToggleStep

const STEPS: Step[] = [
  {
    kind: 'slider',
    key: 'margin',
    block: 'Бизнес-модель',
    question: 'Какая у вас валовая маржа?',
    hint: 'Сколько процентов выручки остаётся после прямых затрат на продукт/услугу.',
    min: 0,
    max: 90,
    step: 1,
    unit: '%',
  },
  {
    kind: 'slider',
    key: 'ltvCacRatio',
    block: 'Бизнес-модель',
    question: 'Во сколько раз клиент окупает стоимость привлечения?',
    hint: 'Отношение LTV к CAC. Здоровая модель — от 3х и выше.',
    min: 0,
    max: 8,
    step: 0.5,
    unit: 'x',
    format: (v) => `${v}x`,
  },
  {
    kind: 'slider',
    key: 'runwayMonths',
    block: 'Кэш / устойчивость',
    question: 'На сколько месяцев хватит денег без новой выручки?',
    hint: 'Запас прочности (runway). Цель — от 12 месяцев.',
    min: 0,
    max: 24,
    step: 1,
    unit: 'мес.',
  },
  {
    kind: 'slider',
    key: 'conversionRate',
    block: 'Продукт и спрос',
    question: 'Какая конверсия из заявки в продажу?',
    hint: 'Процент лидов, которые становятся клиентами.',
    min: 0,
    max: 60,
    step: 1,
    unit: '%',
  },
  {
    kind: 'toggle',
    key: 'hasScripts',
    block: 'Продукт и спрос',
    question: 'Есть ли отлаженные скрипты и материалы продаж?',
    hint: 'Повторяемый процесс продаж, а не «на интуиции».',
    yes: 'Да, есть',
    no: 'Пока нет',
  },
  {
    kind: 'toggle',
    key: 'steadyDemand',
    block: 'Продукт и спрос',
    question: 'Есть ли устойчивый поток заявок?',
    hint: 'Спрос стабилен, а не разовые всплески.',
    yes: 'Да, стабильный',
    no: 'Нестабильный',
  },
]

const DEFAULT_ANSWERS: MiniGriAnswers = {
  margin: 40,
  ltvCacRatio: 3,
  runwayMonths: 6,
  conversionRate: 10,
  hasScripts: false,
  steadyDemand: false,
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone styling
// ─────────────────────────────────────────────────────────────────────────────

const ZONE: Record<MiniGriZone, { color: string; label: string; ring: string; text: string }> = {
  red:   { color: '#ff5d6c', label: 'Зона риска',   ring: 'ring-error/40',   text: 'text-error' },
  amber: { color: '#ffc24b', label: 'Требует роста', ring: 'ring-[#ffc24b]/40', text: 'text-[#ffc24b]' },
  green: { color: '#6effc0', label: 'Сильно',        ring: 'ring-primary/40', text: 'text-primary' },
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Phase = 'quiz' | 'result'

export function MiniGriWizard() {
  const [phase, setPhase] = useState<Phase>('quiz')
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<MiniGriAnswers>(DEFAULT_ANSWERS)

  // Email gate
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  const result = useMemo<MiniGriResult>(() => computeMiniGri(answers), [answers])

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1
  const progress = ((stepIndex + 1) / STEPS.length) * 100

  const weakest = useMemo(
    () => [...result.blocks].sort((a, b) => a.score - b.score)[0],
    [result.blocks]
  )
  const overallZone = zoneForScore(result.overall)

  const radarData = result.blocks.map((b) => ({
    block: b.label,
    score: b.score,
  }))

  function setAnswer<K extends StepKey>(key: K, value: MiniGriAnswers[K]) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  function next() {
    if (isLast) {
      setPhase('result')
      return
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  function prev() {
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setEmailError(null)
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError('Введите корректный e-mail')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/mini-gri', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          answers,
          overallScore: result.overall,
          blockScores: result.blocks,
          locale: 'ru',
        }),
      })
      if (res.status === 429) {
        setEmailError('Слишком много запросов. Попробуйте через минуту.')
        return
      }
      if (!res.ok) {
        setEmailError('Не удалось отправить. Попробуйте ещё раз.')
        return
      }
      setUnlocked(true)
    } catch {
      setEmailError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Quiz phase
  // ───────────────────────────────────────────────────────────────────────────
  if (phase === 'quiz') {
    return (
      <div className="w-full max-w-xl mx-auto">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              {step.block}
            </span>
            <span className="text-xs font-mono text-on-surface-variant">
              {stepIndex + 1} / {STEPS.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-primary-container rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
          </div>
        </div>

        <div className="bg-surface-container border border-white/[0.06] rounded-2xl shadow-card p-6 md:p-8 min-h-[300px] flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col"
            >
              <h2 className="font-headline text-xl md:text-2xl font-bold text-on-surface leading-snug">
                {step.question}
              </h2>
              <p className="text-sm text-on-surface-variant mt-2">{step.hint}</p>

              <div className="flex-1 flex items-center justify-center py-6">
                {step.kind === 'slider' ? (
                  <SliderControl
                    step={step}
                    value={answers[step.key] as number}
                    onChange={(v) => setAnswer(step.key, v)}
                  />
                ) : (
                  <ToggleControl
                    step={step}
                    value={answers[step.key] as boolean}
                    onChange={(v) => setAnswer(step.key, v)}
                  />
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Nav */}
          <div className="flex items-center justify-between gap-3 mt-2">
            <button
              type="button"
              onClick={prev}
              disabled={stepIndex === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all disabled:opacity-30 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
              Назад
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-primary to-primary-container text-on-primary shadow-primary-md hover:scale-[0.98] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {isLast ? 'Показать результат' : 'Далее'}
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Result phase
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-3xl mx-auto"
    >
      <div className="bg-surface-container border border-white/[0.06] rounded-2xl shadow-card overflow-hidden">
        {/* Header / overall */}
        <div className="p-6 md:p-8 border-b border-white/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
              Ваш предварительный GRI
            </span>
            <button
              type="button"
              onClick={() => setPhase('quiz')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary px-2 py-1 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label="Изменить ответы и вернуться к вопросам"
            >
              <span className="material-symbols-outlined text-base">edit</span>
              Изменить ответы
            </button>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-6 mt-4">
            {/* Gauge */}
            <OverallGauge score={result.overall} zone={overallZone} />

            {/* Insight */}
            <div className="flex-1">
              <h2 className="font-headline text-2xl font-bold text-on-surface">
                {result.overall} / 100
              </h2>
              <p
                className={`text-sm font-mono uppercase tracking-[0.15em] mt-1 ${ZONE[overallZone].text}`}
              >
                {ZONE[overallZone].label}
              </p>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-surface-container-high border border-white/[0.04] p-3">
                <span className="material-symbols-outlined text-primary text-lg mt-0.5">
                  lightbulb
                </span>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Слабейший блок —{' '}
                  <span className={`font-semibold ${ZONE[zoneForScore(weakest.score)].text}`}>
                    {weakest.label.toLowerCase()}
                  </span>{' '}
                  ({weakest.score}/100). Именно здесь рост даст самый быстрый эффект.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Radar + blocks */}
        <div className="grid md:grid-cols-2 gap-0">
          {/* Radar */}
          <div className="p-6 md:p-8 md:border-r border-white/[0.06]">
            <div className="h-[260px] w-full">
              <MiniGriRadar data={radarData} />
            </div>
          </div>

          {/* Block bars */}
          <div className="p-6 md:p-8 flex flex-col justify-center gap-4">
            {result.blocks.map((b, i) => {
              const z = zoneForScore(b.score)
              return (
                <motion.div
                  key={b.key}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-on-surface">{b.label}</span>
                    <span className={`text-sm font-mono font-bold ${ZONE[z].text}`}>
                      {b.score}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: ZONE[z].color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${b.score}%` }}
                      transition={{ delay: 0.2 + i * 0.08, duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </motion.div>
              )
            })}
            <p className="text-xs text-on-surface-variant/70 mt-1">
              Показаны 3 из 7 блоков. Полный GRI оценивает ещё операции, команду,
              основателя и позиционирование.
            </p>
          </div>
        </div>

        {/* Email gate / unlock */}
        <div className="p-6 md:p-8 border-t border-white/[0.06] bg-surface-container-low">
          <AnimatePresence mode="wait">
            {!unlocked ? (
              <motion.form
                key="gate"
                onSubmit={handleUnlock}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary text-lg">lock_open</span>
                  <h3 className="font-headline text-lg font-bold text-on-surface">
                    Откройте полный GRI по 7 блокам
                  </h3>
                </div>
                <p className="text-sm text-on-surface-variant mb-4">
                  Оставьте e-mail — пришлём расширенный разбор и доступ к полной
                  диагностике с планом роста.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant/40 text-lg pointer-events-none">
                      mail
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (emailError) setEmailError(null)
                      }}
                      placeholder="you@company.kz"
                      aria-label="E-mail для получения полного GRI"
                      className="w-full h-12 bg-surface-container-high border border-white/[0.06] rounded-xl pl-12 pr-4 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-12 px-6 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-bold bg-gradient-to-r from-primary to-primary-container text-on-primary shadow-primary-md hover:scale-[0.99] active:scale-95 transition-all disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {submitting ? (
                      <span className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                    ) : (
                      <>
                        Открыть полный GRI
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>
                {emailError && (
                  <p className="text-error text-xs mt-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">error</span>
                    {emailError}
                  </p>
                )}
              </motion.form>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/15 mb-3">
                  <span className="material-symbols-outlined text-primary text-2xl">
                    check_circle
                  </span>
                </div>
                <h3 className="font-headline text-lg font-bold text-on-surface">
                  Готово! Доступ открыт
                </h3>
                <p className="text-sm text-on-surface-variant mt-1 mb-5 max-w-md mx-auto">
                  Зарегистрируйтесь, чтобы пройти полную диагностику GRI по 7 блокам
                  и получить персональный план роста.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link
                    href="/register"
                    className="h-12 px-6 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-bold bg-gradient-to-r from-primary to-primary-container text-on-primary shadow-primary-md hover:scale-[0.99] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <span className="material-symbols-outlined text-lg">rocket_launch</span>
                    Получить полный GRI
                  </Link>
                  <Link
                    href="/"
                    className="h-12 px-6 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold border border-white/10 text-on-surface hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    Узнать больше
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SliderControl({
  step,
  value,
  onChange,
}: {
  step: SliderStep
  value: number
  onChange: (v: number) => void
}) {
  const display = step.format ? step.format(value) : `${value} ${step.unit}`
  return (
    <div className="w-full">
      <div className="text-center mb-6">
        <span className="font-mono text-4xl md:text-5xl font-bold text-primary tabular-nums">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={step.min}
        max={step.max}
        step={step.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={step.question}
        className="w-full accent-primary h-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-full"
      />
      <div className="flex justify-between mt-2 text-xs font-mono text-on-surface-variant/60">
        <span>
          {step.min}
          {step.format ? '' : ` ${step.unit}`}
        </span>
        <span>
          {step.max}
          {step.format ? '+' : ` ${step.unit}`}
        </span>
      </div>
    </div>
  )
}

function ToggleControl({
  step,
  value,
  onChange,
}: {
  step: ToggleStep
  value: boolean
  onChange: (v: boolean) => void
}) {
  const options: { val: boolean; label: string; icon: string }[] = [
    { val: true, label: step.yes, icon: 'check_circle' },
    { val: false, label: step.no, icon: 'cancel' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {options.map((opt) => {
        const active = value === opt.val
        return (
          <button
            key={String(opt.val)}
            type="button"
            onClick={() => onChange(opt.val)}
            aria-pressed={active}
            className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              active
                ? 'border-primary/50 bg-primary/10 text-on-surface'
                : 'border-white/[0.06] bg-surface-container-high text-on-surface-variant hover:border-white/10'
            }`}
          >
            <span
              className={`material-symbols-outlined text-2xl ${
                active ? 'text-primary' : 'text-on-surface-variant/50'
              }`}
            >
              {opt.icon}
            </span>
            <span className="text-sm font-medium">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function OverallGauge({ score, zone }: { score: number; zone: MiniGriZone }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = ZONE[zone].color
  return (
    <div className="relative w-32 h-32 flex-shrink-0 mx-auto md:mx-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="9"
        />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl font-bold text-on-surface tabular-nums">
          {score}
        </span>
        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
          GRI
        </span>
      </div>
    </div>
  )
}

export default MiniGriWizard
