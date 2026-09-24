'use client'

import { Rocket, Crown } from 'lucide-react'
import { Skeleton, StatTile, useGigaQuery } from '@/components/giga-panel/kit'
import { ACTIVATION_EVENT_LABEL, fmtPct, type ActivationStats, type FreeToProStats } from '@/lib/analytics/reports'

export function activationTooltip(a: ActivationStats): string {
  const ev = ACTIVATION_EVENT_LABEL[a.event] ?? a.event
  return `Активация = доля клиентов, зарегистрированных за ${a.days} дн., у которых «${ev}» случилось в течение ${a.window_days} дн. после регистрации. `
    + `Активировались ${a.activated} из ${a.registered}; ещё ${a.pending} в пределах окна. Событие и окно — в Настройках → Аналитика.`
}

export function freeToProTooltip(f: FreeToProStats): string {
  return `Free→Pro = клиенты, переведённые на Pro за ${f.days} дн. (события «Тариф изменён», смена тарифа в панели и оплаты Kaspi), `
    + `делённые на (перешедшие + клиенты, которые сейчас на Free). Перешли: ${f.conversions}; сейчас на Free: ${f.free_now}; на Pro всего: ${f.pro_now}.`
}

/** Activation + Free→Pro tiles for the Overview (F-067). */
export function ConversionTiles({ days }: { days: string }) {
  const q = useGigaQuery<{ activation: ActivationStats | null; freeToPro: FreeToProStats | null }>(`/api/giga-admin/analytics?parts=conversion&days=${days}`)
  if (!q.data) return q.error ? null : <><Skeleton className="h-[104px]" /><Skeleton className="h-[104px]" /></>
  const a = q.data.activation
  const f = q.data.freeToPro
  return (
    <>
      <div title={a ? activationTooltip(a) : 'Нет данных: примените миграцию 090'} className="h-full">
        <StatTile
          label="Активация"
          value={a ? fmtPct(a.rate) : '—'}
          hint={a ? `${a.activated} из ${a.registered} · «${ACTIVATION_EVENT_LABEL[a.event] ?? a.event}» за ${a.window_days} дн.` : 'нет данных'}
          icon={<Rocket size={14} />}
          tone="green"
        />
      </div>
      <div title={f ? freeToProTooltip(f) : 'Нет данных: примените миграцию 090'} className="h-full">
        <StatTile
          label="Free → Pro"
          value={f ? fmtPct(f.rate) : '—'}
          hint={f ? `перешли ${f.conversions} · на Pro ${f.pro_now}` : 'нет данных'}
          icon={<Crown size={14} />}
          tone="violet"
        />
      </div>
    </>
  )
}
