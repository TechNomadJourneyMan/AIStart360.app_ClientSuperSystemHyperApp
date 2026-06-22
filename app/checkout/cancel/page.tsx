import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function CheckoutCancelPage() {
  return (
    <div className="min-h-screen bg-surface text-on-surface flex items-center justify-center px-6 py-16">
      <div className="relative w-full max-w-md text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-surface-container-high border border-white/[0.06] flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-on-surface-variant text-4xl">
            cancel
          </span>
        </div>

        <h1 className="font-headline text-3xl font-extrabold leading-tight">
          Оплата отменена
        </h1>
        <p className="mt-4 text-on-surface-variant leading-relaxed">
          Списание не произошло. Вы можете вернуться к выбору тарифа в любой момент —
          доступ к диагностике остаётся открытым.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            href="/#pricing"
            className="bg-primary text-on-primary font-semibold px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Вернуться к тарифам
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-on-surface-variant hover:text-primary transition-colors"
          >
            Перейти в панель
          </Link>
        </div>
      </div>
    </div>
  )
}
