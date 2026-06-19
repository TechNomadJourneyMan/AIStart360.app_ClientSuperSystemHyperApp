import Link from 'next/link'

export const metadata = { title: 'Инсайты — Expert Portal' }

/**
 * Expert insights overview.
 *
 * Previously this page rendered a hardcoded mock list of fabricated insights
 * (ARR +18.2%, ₸4.2 млрд, churn 2.1%, …). That violated the no-fabricated-data
 * mandate, so it now shows an honest state: AI insights are produced per client
 * (point_a_insights) after their diagnostic, and the expert reviews them inside
 * each client's profile. There is no aggregate cross-client insight feed yet.
 */
export default function ExpertInsightsPage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Инсайты</h1>
        <p className="text-on-surface-variant mt-2 text-sm">AI-инсайты по каждому клиенту на основе его данных</p>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-primary/60 block mb-4" aria-hidden>
          lightbulb
        </span>
        <h2 className="font-headline text-xl font-bold text-on-surface mb-2">
          Инсайты формируются по каждому клиенту
        </h2>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
          AI-инсайты появляются в профиле клиента после прохождения им диагностики (Точка А).
          Откройте клиента, чтобы просмотреть, подтвердить или скорректировать его инсайты.
          Сводной ленты инсайтов по всем клиентам пока нет.
        </p>
        <Link
          href="/expert/clients"
          className="inline-flex items-center gap-2 mt-6 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm px-5 py-2.5 rounded-xl transition-all"
        >
          <span className="material-symbols-outlined text-base" aria-hidden>group</span>
          Перейти к клиентам
        </Link>
      </section>
    </div>
  )
}
