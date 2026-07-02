'use client'

/**
 * components/assistant/mascot/MascotTutorial.tsx — the onboarding tour.
 *
 * Big modal cards where the mascot itself «teaches» the platform (ТЗ v1.3):
 * large avatar in a talking pose, step title/text, progress dots, Назад /
 * Дальше / Пропустить. Shown once on the first visit (settings.tutorialDone
 * false) and replayable from Settings › Ассистент. While it is open, the
 * aria-modal dialog automatically suppresses proactive bubbles (the mascot's
 * foreign-dialog guard sees it).
 */

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MascotAvatar } from './MascotAvatar'
import { getCharacter, type MascotCharacterId } from '@/lib/assistant/mascot/characters'
import type { MascotState } from '@/lib/assistant/mascot/types'

interface TutorialStep {
  pose: MascotState
  title: (name: string) => string
  text: string
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    pose: 'greeting',
    title: (n) => `Привет! Я ${n} 🐾`,
    text: 'Я живу в углу экрана и помогу пройти диагностику бизнеса: подскажу следующий шаг, объясню результаты и отвечу на вопросы. Работаю только с вашими данными — без догадок.',
  },
  {
    pose: 'hint',
    title: () => 'Дашборд — центр управления',
    text: 'Здесь собрано всё главное: прогресс анкеты, ключевые метрики, Точка А и анализ рынка. Начинайте день с дашборда — он покажет, что требует внимания.',
  },
  {
    pose: 'question',
    title: () => 'Анкета — основа диагностики',
    text: '12 разделов о продажах, финансах и команде. Не гонитесь за точностью до тенге: приблизительные цифры лучше пустых полей — уточните позже, а я подскажу формат.',
  },
  {
    pose: 'insight',
    title: () => 'GRI и Точка А — ваши результаты',
    text: 'GRI — индекс готовности к росту от 0 до 10 с главными ограничениями. Точка А — честный разбор бизнеса по блокам. Начинать стоит с самого слабого блока — это самый быстрый рост.',
  },
  {
    pose: 'idle',
    title: (n) => `${n} всегда рядом`,
    text: 'Кликните по мне — открою чат по вашим данным. В меню «⋯» — AI-инсайт, сворачивание и настройки. Иногда я гуляю по экрану или сплю — не пугайтесь, работа от этого не страдает 🐾',
  },
]

export function MascotTutorial({
  open,
  character,
  onClose,
}: {
  open: boolean
  character: MascotCharacterId
  /** done=true — прошёл до конца; false — пропустил (оба помечают tutorialDone). */
  onClose: (done: boolean) => void
}) {
  const [step, setStep] = useState(0)
  const c = getCharacter(character)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  const finish = useCallback(
    (done: boolean) => {
      onClose(done)
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false)
      if (e.key === 'ArrowRight' && step < TUTORIAL_STEPS.length - 1) setStep((s) => s + 1)
      if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, finish])

  if (!open) return null

  const s = TUTORIAL_STEPS[step]
  const last = step === TUTORIAL_STEPS.length - 1

  return (
    <AnimatePresence>
      <motion.div
        key="tutorial-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={() => finish(false)}
      >
        <motion.div
          key="tutorial-card"
          role="dialog"
          aria-modal="true"
          aria-label={`Обучение: шаг ${step + 1} из ${TUTORIAL_STEPS.length}`}
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg rounded-3xl border border-white/[0.1] bg-[#12151c] shadow-2xl shadow-black/60 p-6 sm:p-8"
        >
          <button
            onClick={() => finish(false)}
            aria-label="Пропустить обучение"
            className="absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-all"
          >
            Пропустить
          </button>

          {/* The mascot «speaks» — big avatar + a comic bubble card. */}
          <div className="flex flex-col items-center text-center">
            <motion.div
              key={`pose-${step}`}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              <MascotAvatar pose={s.pose} character={character} size={132} />
            </motion.div>

            <motion.div
              key={`text-${step}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.05 }}
              className="mt-4"
            >
              <h2 className="font-headline text-xl sm:text-2xl font-extrabold text-on-surface">
                {s.title(c.name)}
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-3 max-w-md mx-auto">
                {s.text}
              </p>
            </motion.div>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2 mt-6" aria-hidden>
            {TUTORIAL_STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-6 bg-primary' : 'w-1.5 bg-white/[0.15] hover:bg-white/[0.3]'
                }`}
              />
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between gap-3 mt-6">
            <button
              onClick={() => setStep((v) => Math.max(0, v - 1))}
              disabled={step === 0}
              className="px-4 py-2.5 rounded-xl text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Назад
            </button>
            <button
              onClick={() => (last ? finish(true) : setStep((v) => v + 1))}
              className="flex-1 max-w-[220px] px-5 py-2.5 rounded-xl bg-primary text-[#003824] font-bold text-sm hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {last ? 'Начать работу 🐾' : 'Дальше'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
