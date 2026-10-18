'use client'

/**
 * components/point-b/PointBPaywall.tsx — the Pro placeholder shown instead of
 * Point B when the tariff gates are on and the account has no `point_b`.
 * Draws no client data and makes no data request; the only call is the optional
 * «Узнать о Pro» (the same upgrade request as the sidebar). Project tokens only —
 * the look is to be replaced by the PO's design.
 */
import { useState } from 'react'
import { BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { sendUpgradeRequest, type UpgradeRequestState } from './pointBAccess'

const FEATURES = [
  { icon: 'flag', text: 'Цели и план: что нужно сделать, чтобы прийти к целевой выручке' },
  { icon: 'fact_check', text: 'Проверка целей и плана экспертом перед тем, как вы их увидите' },
  { icon: 'route', text: 'Сценарии, дорожная карта и отслеживание прогресса' },
]

export default function PointBPaywall() {
  const [state, setState] = useState<'idle' | 'sending' | UpgradeRequestState>('idle')

  const request = async () => {
    if (state === 'sending' || state === 'sent') return
    setState('sending')
    setState(await sendUpgradeRequest(fetch))
  }

  return (
    <section className={`${CARD} mx-auto max-w-2xl`} aria-labelledby="pb-paywall-title">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
          <Icon name="lock" className="text-2xl text-primary" />
        </span>
        <div className="min-w-0">
          <span className={`${CHIP} bg-primary/10 text-primary`}>Тариф Pro</span>
          <h2 id="pb-paywall-title" className="mt-1.5 text-lg font-bold text-on-surface">Точка Б — на тарифе Pro</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Точка Б доступна на тарифе Pro вместе с полным GRI и Точкой А.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {FEATURES.map((f) => (
          <li key={f.icon} className="flex items-start gap-2 text-sm text-on-surface-variant">
            <Icon name={f.icon} className="mt-0.5 text-base text-primary" />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void request()}
          disabled={state === 'sending' || state === 'sent'}
          data-track="pro-upgrade-request"
          className={BTN_PRIMARY}
        >
          {state === 'sending' ? 'Отправляем…' : state === 'sent' ? 'Заявка отправлена' : 'Узнать о Pro'}
        </button>
        <p role="status" aria-live="polite" className="text-xs">
          {state === 'sent' && <span className="text-primary">Мы скоро свяжемся с вами и откроем доступ.</span>}
          {state === 'error' && <span className="text-error">Не удалось отправить заявку. Попробуйте ещё раз.</span>}
        </p>
      </div>
    </section>
  )
}
