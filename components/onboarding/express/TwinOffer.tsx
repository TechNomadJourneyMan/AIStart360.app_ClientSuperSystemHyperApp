'use client'

import type { TwinOffer as Offer } from '@/lib/survey/twins'

/**
 * «Вы уже ответили на похожий вопрос: 6 ч/день. Подходит и здесь? [Да] [Изменить]»
 * (spec §7.6). Nothing is written until «Да».
 */
export function TwinOffer({ offer, onAccept, onEdit }: { offer: Offer; onAccept: () => void; onEdit: () => void }) {
  return (
    <div role="group" aria-label="Похожий вопрос" className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2.5 text-xs text-on-surface">
      <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">content_copy</span>
      <span className="flex-1 min-w-[12rem]">
        Вы уже ответили на похожий вопрос («{offer.fromLabel}»): <b className="font-semibold">{offer.text}</b>. Подходит и здесь?
      </span>
      <button type="button" onClick={onAccept} className="min-h-[36px] rounded-lg bg-primary/15 px-3 font-semibold text-primary hover:bg-primary/25">Да</button>
      <button type="button" onClick={onEdit} className="min-h-[36px] rounded-lg px-3 text-on-surface-variant hover:text-on-surface">Изменить</button>
    </div>
  )
}
