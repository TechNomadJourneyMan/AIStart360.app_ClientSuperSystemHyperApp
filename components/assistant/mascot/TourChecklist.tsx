'use client'

/**
 * components/assistant/mascot/TourChecklist.tsx — чеклист экскурсии «Первые шаги»
 * (Фаза 3, Батч B). Плавающая компактная карточка-«оглавление»: список стопов с
 * галочками, текущий подсвечен, прогресс N/M. Видна, пока tourGuide.status ===
 * 'active'. Управляет ею MascotAssistant (движок экскурсии).
 *
 * Два визуальных состояния:
 *   • collapsed — тонкая «пилюля» «🐾 Первые шаги · N/M» (пока идёт коачмарк-шаг,
 *     чтобы не спорить с оверлеем; кликом разворачивается);
 *   • expanded  — карточка со списком шагов и кнопками «Продолжить» / «Свернуть»
 *     / «Пропустить экскурсию» (на резюме после перезагрузки показывается так,
 *     чтобы пользователь сам нажал «Продолжить» — шаг не автозапускается).
 *
 * Позиционируется сверху по центру (мобилка) / справа (десктоп), выше оверлея
 * коачмарка (z-[80]), поэтому прогресс виден и во время шага. Тёмный стиль Гри.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { MascotAvatar, type MascotColorId } from './MascotAvatar'
import type { MascotCharacterId } from '@/lib/assistant/mascot/characters'
import { clampStepIdx, type TourGuideStep } from '@/lib/assistant/mascot/tour-guide'

interface TourChecklistProps {
  route: TourGuideStep[]
  /** Текущий шаг (0-based) из settings.tourGuide.stepIdx. */
  stepIdx: number
  /** Свёрнута ли карточка (пилюля). */
  collapsed: boolean
  /** Идёт ли живой прогон (guideRunning) — влияет на акцент «Продолжить». */
  running: boolean
  character: MascotCharacterId
  color: MascotColorId
  /** «Продолжить» — (пере)запустить текущий шаг (главное на резюме). */
  onContinue: () => void
  /** Свернуть/развернуть. */
  onToggleCollapsed: () => void
  /** «Пропустить экскурсию» — статус dismissed. */
  onSkip: () => void
}

export function TourChecklist({
  route,
  stepIdx,
  collapsed,
  running,
  character,
  color,
  onContinue,
  onToggleCollapsed,
  onSkip,
}: TourChecklistProps) {
  const reduceMotion = useReducedMotion()
  if (route.length === 0) return null
  const total = route.length
  // При prefers-reduced-motion — без движения (только мгновенное появление).
  const pill = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.18 } }
  const card = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: -10, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -8, scale: 0.98 }, transition: { duration: 0.2 } }
  // clampStepIdx допускает total-сентинел «пройдено»; для подсветки прижимаем к
  // последнему видимому шагу. «Пройдено» = число шагов до текущего.
  const current = Math.min(clampStepIdx(stepIdx, total), total - 1)
  const doneCount = Math.min(clampStepIdx(stepIdx, total), total)

  if (collapsed) {
    return (
      <motion.button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={`Экскурсия «Первые шаги»: пройдено ${doneCount} из ${total}. Развернуть`}
        initial={pill.initial}
        animate={pill.animate}
        exit={pill.exit}
        transition={pill.transition}
        className="fixed left-1/2 top-4 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.12] bg-[#12151c]/95 py-1.5 pl-1.5 pr-3.5 shadow-xl shadow-black/40 backdrop-blur-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 lg:left-auto lg:right-6 lg:translate-x-0"
      >
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-surface-container-high">
          <MascotAvatar pose="hint" character={character} color={color} size={22} headOnly paused />
        </span>
        <span className="text-xs font-semibold text-on-surface">Первые шаги</span>
        <span className="text-[11px] font-mono text-primary">
          {doneCount}/{total}
        </span>
      </motion.button>
    )
  }

  return (
    <motion.div
      role="dialog"
      aria-label="Экскурсия по порталу «Первые шаги»"
      initial={card.initial}
      animate={card.animate}
      exit={card.exit}
      transition={card.transition}
      className="fixed left-1/2 top-4 z-[80] w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 rounded-2xl border border-white/[0.12] bg-[#12151c]/98 p-4 shadow-2xl shadow-black/50 backdrop-blur-sm lg:left-auto lg:right-6 lg:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high">
          <MascotAvatar pose="greeting" character={character} color={color} size={30} headOnly paused />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-on-surface">Первые шаги</p>
            <span className="shrink-0 text-[11px] font-mono text-primary">
              {doneCount}/{total}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-on-surface-variant">
            Короткий тур по ключевым разделам — прервать можно в любой момент.
          </p>
        </div>
      </div>

      {/* Прогресс-бар */}
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
        />
      </div>

      {/* Список шагов */}
      <ul className="mt-3 flex flex-col gap-0.5">
        {route.map((stop, i) => {
          const isDone = i < current
          const isCurrent = i === current
          return (
            <li
              key={stop.screen}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                isCurrent ? 'bg-primary/[0.12] text-on-surface' : 'text-on-surface-variant'
              }`}
            >
              <span
                aria-hidden
                className={`material-symbols-outlined text-base leading-none ${
                  isDone ? 'text-primary' : isCurrent ? 'text-primary' : 'text-on-surface-variant/50'
                }`}
              >
                {isDone ? 'check_circle' : isCurrent ? 'radio_button_checked' : 'radio_button_unchecked'}
              </span>
              <span className={`truncate ${isCurrent ? 'font-semibold' : ''}`}>{stop.title}</span>
            </li>
          )
        })}
      </ul>

      {/* Действия */}
      <div className="mt-3.5 flex items-center gap-2">
        <button
          onClick={onContinue}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {running ? 'К текущему шагу' : 'Продолжить'}
        </button>
        <button
          onClick={onToggleCollapsed}
          aria-label="Свернуть чеклист"
          title="Свернуть"
          className="rounded-lg border border-white/[0.1] px-2.5 py-2 text-on-surface-variant transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20"
        >
          <span className="material-symbols-outlined text-base leading-none">minimize</span>
        </button>
      </div>
      <button
        onClick={onSkip}
        className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-[11px] text-on-surface-variant transition-colors hover:bg-white/[0.06] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        Пропустить экскурсию
      </button>
    </motion.div>
  )
}
