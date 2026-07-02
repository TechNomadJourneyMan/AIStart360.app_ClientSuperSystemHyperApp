import Link from 'next/link'
import { getPlan } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export default function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: { plan?: string }
}) {
  const planKey = searchParams.plan ?? ''
  const plan = getPlan(planKey)

  return (
    <div className="relative overflow-hidden min-h-screen bg-surface text-on-surface flex items-center justify-center px-6 py-16">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-primary text-4xl">check_circle</span>
        </div>

        <h1 className="font-headline text-3xl font-extrabold leading-tight">
          Оплата прошла успешно
        </h1>
        <p className="mt-4 text-on-surface-variant leading-relaxed">
          {plan ? (
            <>
              Тариф <span className="text-primary font-semibold">{plan.label}</span> активирован.
            </>
          ) : (
            <>Доступ активирован.</>
          )}{' '}
          Это демонстрационная оплата — реальное списание не производилось.
        </p>

        <div className="mt-8 inline-flex items-center gap-2 bg-tertiary-container/15 border border-tertiary-container/30 px-3 py-1.5 rounded-full">
          <span className="material-symbols-outlined text-tertiary-container text-sm">science</span>
          <span className="text-xs font-mono text-tertiary-container uppercase tracking-[0.2em]">
            Заглушка эквайринга
          </span>
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="bg-primary text-on-primary font-semibold px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined">space_dashboard</span>
            Перейти в панель
          </Link>
          <Link
            href="/"
            className="text-sm text-on-surface-variant hover:text-primary transition-colors"
          >
            ← На главную
          </Link>
        </div>
      </div>
    </div>
  )
}
