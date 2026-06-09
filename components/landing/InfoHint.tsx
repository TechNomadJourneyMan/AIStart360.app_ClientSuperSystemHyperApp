'use client'

// ─────────────────────────────────────────────────────────────────────
//  InfoHint — надстрочный значок «?» рядом с термином. По клику открывает
//  центрированное всплывающее окно (модалку) с описанием, подсказками и
//  мини-туториалом «как попробовать». Модалка появляется по центру экрана
//  с затемнением, не зависит от прокрутки и закрывается по клику вне,
//  крестику или Escape.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

type GlossaryEntry = {
  title: string
  icon: string
  summary: string
  hints: string[]
  tutorial: string[]
  href?: string
  cta?: string
}

export const GLOSSARY = {
  'ии-диагностика': {
    title: 'ИИ-диагностика',
    icon: 'monitor_heart',
    summary:
      'ИИ собирает полную картину бизнеса из анкеты и ваших документов — финансы, маркетинг, продажи, операции, команда — и превращает её в Точку А и план роста.',
    hints: [
      'Чем больше отчётов загрузите, тем точнее диагностика',
      'Достаточно P&L и выгрузки из CRM за 2 квартала',
      'Данные обрабатываются и хранятся на вашей инфраструктуре',
    ],
    tutorial: [
      'Зарегистрируйтесь и пройдите анкету (~15 минут)',
      'Загрузите отчёты в разделе «Мои данные»',
      'Через несколько минут откроется Точка А',
    ],
    href: '/register',
    cta: 'Пройти диагностику',
  },
  gri: {
    title: 'GRI — индекс готовности к росту',
    icon: 'radar',
    summary:
      'Growth Readiness Index — единый балл /10, который показывает, насколько бизнес готов к росту по 7 ключевым блокам: бизнес-модель, основатель, доверие, касса, продукт, команда, операции.',
    hints: [
      'Целевой ориентир — ≥ 7/10 по каждому блоку',
      'Красные блоки — это ваши «бутылочные горлышки»',
      'Балл пересчитывается при обновлении данных',
    ],
    tutorial: [
      'Откройте раздел GRI в кабинете',
      'Посмотрите балл по 7 блокам',
      'Начните работу с самого слабого блока',
    ],
    href: '/register',
    cta: 'Рассчитать GRI',
  },
  'gri-test': {
    title: 'GRI-тест',
    icon: 'fact_check',
    summary:
      'Быстрый опросник готовности к росту. Отвечаете на блок вопросов — сразу получаете расчёт GRI и слабые зоны, без полного внедрения и загрузки документов.',
    hints: [
      'Занимает 10–15 минут',
      'Можно пройти ещё до загрузки отчётов',
      'Результат — стартовая Точка А',
    ],
    tutorial: [
      'Запустите GRI-тест',
      'Ответьте на вопросы по блокам',
      'Получите предварительный балл и приоритеты',
    ],
    href: '/register',
    cta: 'Пройти GRI-тест',
  },
  'gri-pulse': {
    title: 'GRI Pulse',
    icon: 'cell_tower',
    summary:
      'Живой мониторинг готовности. Балл и метрики пересчитываются на новых данных — видно динамику и отклонения в реальном времени, а не раз в год.',
    hints: [
      'Подключите интеграции, чтобы балл обновлялся автоматически',
      'Настройте алёрты на отклонения метрик',
      'Следите за трендом, а не за разовым значением',
    ],
    tutorial: [
      'Откройте GRI Pulse',
      'Подключите источники данных (CRM, 1С, GA)',
      'Включите уведомления об отклонениях',
    ],
    href: '/register',
    cta: 'Включить Pulse',
  },
  'точка-а': {
    title: 'Точка А',
    icon: 'my_location',
    summary:
      'Где бизнес находится сейчас: GRI-балл, сильные и слабые блоки, риски, быстрые победы и стратегические приоритеты, собранные ИИ.',
    hints: [
      'Это «снимок» текущего состояния бизнеса',
      'Быстрые победы — что можно улучшить за недели',
      'Риски отсортированы по влиянию на рост',
    ],
    tutorial: [
      'Завершите ИИ-диагностику',
      'Откройте раздел «Точка А»',
      'Изучите приоритеты и быстрые победы',
    ],
    href: '/register',
    cta: 'Получить Точку А',
  },
  'точка-б': {
    title: 'Точка Б',
    icon: 'flag',
    summary:
      'Цель, к которой идём: 11 целей роста, GAP-анализ между А и Б и дорожная карта на 90 дней с конкретными шагами по неделям.',
    hints: [
      'Цели формулируются в измеримых метриках',
      'GAP показывает, что именно отделяет вас от цели',
      'Дорожная карта разбита по неделям',
    ],
    tutorial: [
      'Откройте раздел «Точка Б»',
      'Выберите цели роста',
      'Следуйте 90-дневной дорожной карте',
    ],
    href: '/register',
    cta: 'Построить маршрут',
  },
  метрики: {
    title: '122 метрики бизнеса',
    icon: 'monitoring',
    summary:
      '122 показателя по 7 отделам. Каждая метрика знает свой источник: поле анкеты, выгрузка 1С, документ, Google Analytics или CRM — никаких «общих мест».',
    hints: [
      'Метрики связаны между собой',
      'Источник у каждой метрики прозрачен',
      'Часть метрик заполняется автоматически из документов',
    ],
    tutorial: [
      'Откройте раздел «Метрики»',
      'Проверьте источники данных',
      'Дозагрузите недостающие отчёты',
    ],
    href: '/register',
    cta: 'Смотреть метрики',
  },
  рынок: {
    title: 'Рынок',
    icon: 'public',
    summary:
      'Объём ниши, динамика рынка и позиция вашей компании — с привязкой к вашим собственным цифрам, а не к усреднённым отчётам.',
    hints: [
      'Сравнение идёт по вашей отрасли и региону',
      'Позиция считается от ваших метрик',
      'Раздел входит в тариф Pro',
    ],
    tutorial: [
      'Откройте раздел «Рынок»',
      'Укажите отрасль и регион',
      'Сравните свою позицию с рынком',
    ],
    href: '/register',
    cta: 'Открыть рынок',
  },
  конкуренты: {
    title: 'Конкуренты',
    icon: 'compare_arrows',
    summary:
      'Сравнение с игроками рынка по ключевым KPI: наглядно видно, где вы выигрываете, а где отстаёте.',
    hints: [
      'Добавьте конкурентов для сравнения',
      'Сравнение идёт по сопоставимым метрикам',
      'Используйте для постановки целей в Точке Б',
    ],
    tutorial: [
      'Откройте «Конкуренты»',
      'Добавьте компании для сравнения',
      'Найдите зоны отставания',
    ],
    href: '/register',
    cta: 'Сравнить с рынком',
  },
  инсайты: {
    title: 'Инсайты',
    icon: 'lightbulb',
    summary:
      'ИИ объясняет, что стоит за цифрами: формулирует выводы и гипотезы простым человеческим языком и подсвечивает неочевидные связи.',
    hints: [
      'Инсайты обновляются вместе с данными',
      'Каждый инсайт можно превратить в задачу',
      'Помогают увидеть скрытые зависимости',
    ],
    tutorial: [
      'Откройте раздел «Инсайты»',
      'Прочитайте выводы ИИ',
      'Возьмите гипотезы в работу',
    ],
    href: '/register',
    cta: 'Смотреть инсайты',
  },
  разведка: {
    title: 'Разведка',
    icon: 'hub',
    summary:
      'Сбор и связывание данных о рынке и конкурентах в единую карту для управленческих решений на фактах, а не на ощущениях.',
    hints: [
      'Объединяет внешние и внутренние данные',
      'Помогает готовить решения на фактах',
      'Часть рыночного блока платформы',
    ],
    tutorial: [
      'Откройте «Разведку»',
      'Соберите данные по рынку',
      'Используйте карту для решений',
    ],
    href: '/register',
    cta: 'Открыть разведку',
  },
  сценарии: {
    title: 'Сценарии',
    icon: 'alt_route',
    summary:
      'What-if моделирование: «что будет с выручкой, если…». Проигрываете управленческие решения до того, как потратили деньги.',
    hints: [
      'Меняйте параметры и сразу смотрите результат',
      'Сравнивайте несколько сценариев',
      'Связаны с метриками и целями роста',
    ],
    tutorial: [
      'Откройте «Сценарии»',
      'Задайте условие (например, +10% к цене)',
      'Сравните исходы и выберите лучший',
    ],
    href: '/register',
    cta: 'Смоделировать',
  },
  'ai-парсер': {
    title: 'AI-парсер документов',
    icon: 'auto_awesome',
    summary:
      'Извлекает 30–60 ключевых цифр из P&L, баланса и выгрузок CRM и автоматически раскладывает их по отделам и метрикам.',
    hints: [
      'Поддерживает PDF, DOCX, XLSX, CSV, TXT до 50 МБ',
      'Точность маппинга ~92%',
      'Есть проверка и ручная корректировка полей',
    ],
    tutorial: [
      'Откройте «Мои данные»',
      'Перетащите отчёт в загрузчик',
      'Проверьте распознанные поля',
    ],
    href: '/register',
    cta: 'Загрузить отчёт',
  },
} satisfies Record<string, GlossaryEntry>

export type GlossaryKey = keyof typeof GLOSSARY

interface InfoHintProps {
  term: GlossaryKey
  /** размер значка */
  size?: 'sm' | 'md'
  className?: string
}

export function InfoHint({ term, size = 'sm', className = '' }: InfoHintProps) {
  const [open, setOpen] = useState(false)
  const data = GLOSSARY[term]

  // Esc для закрытия + блокировка прокрутки фона, пока окно открыто
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!data) return null

  const dim = size === 'md' ? 'w-[18px] h-[18px] text-[11px]' : 'w-4 h-4 text-[10px]'

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label={`Подробнее: ${data.title}`}
        aria-expanded={open}
        className={`relative -top-1.5 ml-0.5 inline-flex items-center justify-center shrink-0 rounded-full border align-baseline transition-all
          ${dim}
          ${open
            ? 'bg-primary text-on-primary border-primary'
            : 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 hover:border-primary/60'}
          ${className}`}
      >
        <span className="font-mono font-bold leading-none">?</span>
      </button>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={data.title}
          >
            {/* Backdrop */}
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/65 backdrop-blur-sm cursor-default"
            />

            {/* Panel */}
            <div className="landing-rise relative w-full max-w-[380px] max-h-[85vh] overflow-y-auto no-scrollbar rounded-3xl border border-white/[0.1] bg-[#13151c] shadow-modal p-6 text-left">
              <span className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

              {/* Close */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
                className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>

              {/* Header */}
              <div className="flex items-start gap-3 mb-4 pr-8">
                <div className="w-11 h-11 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">{data.icon}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.15em] mb-0.5">что это</p>
                  <p className="font-headline text-base font-bold text-on-surface leading-tight">{data.title}</p>
                </div>
              </div>

              <p className="text-sm text-on-surface-variant leading-relaxed mb-5">{data.summary}</p>

              {/* Hints */}
              <p className="text-[10px] font-mono text-on-surface-variant/55 uppercase tracking-[0.15em] mb-2">подсказки</p>
              <ul className="space-y-2 mb-5">
                {data.hints.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-[13px] text-on-surface-variant leading-snug">
                    <span className="material-symbols-outlined text-primary text-[16px] mt-px shrink-0">tips_and_updates</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {/* Tutorial */}
              <p className="text-[10px] font-mono text-on-surface-variant/55 uppercase tracking-[0.15em] mb-2">как попробовать</p>
              <ol className="space-y-2 mb-6">
                {data.tutorial.map((t, i) => (
                  <li key={t} className="flex items-start gap-2.5 text-[13px] text-on-surface leading-snug">
                    <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-mono font-bold flex items-center justify-center shrink-0 mt-px">
                      {i + 1}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>

              {data.href && (
                <Link
                  href={data.href}
                  className="group flex items-center justify-center gap-1.5 w-full bg-primary text-on-primary text-sm font-semibold py-3 rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all"
                >
                  {data.cta || 'Попробовать'}
                  <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                </Link>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
