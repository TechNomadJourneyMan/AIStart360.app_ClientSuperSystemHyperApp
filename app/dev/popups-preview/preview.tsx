'use client'

import { useState } from 'react'
import { PopupCard } from '@/components/popups/PopupCard'
import { PopupModal } from '@/components/popups/PopupModal'
import type { PopupCandidate } from '@/lib/popups/types'

const base: PopupCandidate = {
  id: 'preview-1',
  kind: 'expert_message',
  display: 'card',
  priority: 2,
  title: 'Сообщение от эксперта',
  body: 'Добрый день! Посмотрел вашу цель на год: 96 млн ₸ выглядит достижимой при росте конверсии с 11% до 13%. Давайте согласуем срок и первые шаги — ответьте, когда удобно.',
  authorName: 'Айгерим К.',
  authorSpecialty: 'Эксперт по продажам',
  createdAt: new Date().toISOString(),
  href: '/client/messages',
  important: false,
  canReply: true,
}

export default function PopupsPreview() {
  const [mode, setMode] = useState<'card' | 'modal' | 'none'>('card')
  const noop = async () => {}
  return (
    <main className="min-h-screen bg-[#0A0B0F] px-6 py-6 text-on-surface">
      <nav className="mb-6 flex gap-2 text-sm" aria-label="Вариант окна">
        {(['card', 'modal', 'none'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
            className={`rounded-lg border px-3 py-1.5 ${mode === m ? 'border-primary/40 text-primary' : 'border-white/[0.08] text-on-surface-variant'}`}>
            {m === 'card' ? 'Карточка' : m === 'modal' ? 'Модальное (важное)' : 'Без окна'}
          </button>
        ))}
      </nav>
      <p className="max-w-xl text-sm text-on-surface-variant">
        Фон кабинета-заглушка. Круг справа снизу — место виджета «Гри» (на проде он реальный), слой окон не должен его перекрывать.
      </p>
      <div aria-hidden className="fixed bottom-6 right-6 z-30 h-16 w-16 rounded-full border border-white/20 bg-white/10 text-center text-[10px] leading-[4rem] max-lg:bottom-20">Гри</div>
      {mode === 'card' && (
        <div data-popup-layer aria-live="polite" className="pointer-events-none fixed bottom-20 left-3 right-[6.5rem] z-40 max-w-md lg:bottom-6 lg:left-6 lg:right-auto lg:w-[22rem]">
          <PopupCard popup={base} onDismiss={noop} onSnooze={noop} onReply={noop} />
        </div>
      )}
      {mode === 'modal' && (
        <PopupModal popup={{ ...base, display: 'modal', important: true, title: 'Эксперт ждёт вашего ответа' }} onDismiss={() => setMode('none')} onSnooze={noop} onReply={noop} />
      )}
    </main>
  )
}
