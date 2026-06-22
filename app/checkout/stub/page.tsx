import Link from 'next/link'
import { getPlan } from '@/lib/payments'

export const dynamic = 'force-dynamic'

const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  cloudpayments: 'CloudPayments',
  kaspi: 'Kaspi.kz',
  halyk: 'Halyk Pay (ePay)',
  mir: 'Мир / Visa / Mastercard',
}

const GATEWAYS = [
  { name: 'Stripe', region: 'международные карты' },
  { name: 'CloudPayments', region: 'СНГ' },
  { name: 'Kaspi.kz', region: 'Казахстан' },
  { name: 'Halyk Pay', region: 'Казахстан · Halyk Bank' },
  { name: 'Мир / Visa / Mastercard', region: 'Россия и СНГ' },
] as const

function fmtAmount(amountMinor: number, currency: string): string {
  const major = amountMinor / 100
  const symbol = currency === 'USD' ? '$' : ''
  const suffix = currency === 'USD' ? '' : ' ' + currency
  return `${symbol}${major.toLocaleString('ru-RU')}${suffix}`
}

export default function CheckoutStubPage({
  searchParams,
}: {
  searchParams: { provider?: string; plan?: string }
}) {
  const providerKey = searchParams.provider ?? 'stripe'
  const providerLabel = PROVIDER_LABELS[providerKey] ?? providerKey
  const planKey = searchParams.plan ?? ''
  const plan = getPlan(planKey)

  const successHref = `/checkout/success?plan=${encodeURIComponent(planKey)}`

  return (
    <div className="min-h-screen bg-surface text-on-surface flex items-center justify-center px-6 py-16">
      {/* Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-lg">
        {/* Stub banner */}
        <div className="inline-flex items-center gap-2 bg-tertiary-container/20 border border-tertiary-container/40 px-3 py-1.5 rounded-full mb-6">
          <span className="material-symbols-outlined text-tertiary-container text-base">
            science
          </span>
          <span className="text-xs font-mono text-tertiary-container uppercase tracking-[0.2em]">
            Демо · заглушка
          </span>
        </div>

        <div className="bg-surface-container rounded-2xl border border-white/10 shadow-modal p-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-primary text-2xl">credit_card</span>
            <h1 className="font-headline text-2xl font-extrabold leading-tight">
              Демонстрационный эквайринг
            </h1>
          </div>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Это <span className="text-on-surface font-semibold">заглушка</span> платёжного шлюза.
            Реальная оплата не списывается — деньги не двигаются. Платёжные провайдеры
            будут подключены позже.
          </p>

          {/* Chosen plan + provider */}
          <div className="mt-6 grid grid-cols-1 gap-px bg-white/[0.06] rounded-xl overflow-hidden border border-white/[0.06]">
            <div className="bg-surface-container-low px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-on-surface-variant uppercase tracking-wider">
                Провайдер
              </span>
              <span className="font-mono text-sm text-on-surface">{providerLabel}</span>
            </div>
            <div className="bg-surface-container-low px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-on-surface-variant uppercase tracking-wider">
                Тариф
              </span>
              <span className="font-mono text-sm text-on-surface">
                {plan ? plan.label : planKey || '—'}
              </span>
            </div>
            {plan && (
              <div className="bg-surface-container-low px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-on-surface-variant uppercase tracking-wider">
                  Сумма
                </span>
                <span className="font-mono text-sm font-bold text-primary">
                  {fmtAmount(plan.amount, plan.currency)}
                  {plan.interval === 'month' && (
                    <span className="text-on-surface-variant/70"> / мес</span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Simulate success */}
          <Link
            href={successHref}
            className="mt-6 w-full bg-primary text-on-primary text-center font-semibold px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined">check_circle</span>
            Симулировать успешную оплату
          </Link>
          <Link
            href="/checkout/cancel"
            className="mt-3 w-full border border-white/[0.08] text-on-surface-variant text-center font-medium px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:border-error/40 hover:text-error transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Отменить
          </Link>
        </div>

        {/* Which gateways will be wired */}
        <div className="mt-6 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-4">
            Будут подключены реальные шлюзы
          </p>
          <ul className="space-y-2.5">
            {GATEWAYS.map((g) => (
              <li key={g.name} className="flex items-center gap-3">
                <span className="material-symbols-outlined text-on-surface-variant/50 text-base">
                  lock
                </span>
                <span className="text-sm text-on-surface">{g.name}</span>
                <span className="text-xs text-on-surface-variant/60 ml-auto">{g.region}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-center text-xs text-on-surface-variant/60">
          <Link href="/" className="hover:text-primary transition-colors">
            ← Вернуться на главную
          </Link>
        </p>
      </div>
    </div>
  )
}
