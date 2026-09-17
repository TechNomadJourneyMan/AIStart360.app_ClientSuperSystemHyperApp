export const dynamic = 'force-dynamic'

import { getSetting } from '@/lib/settings/store'
import MaintenanceWatcher from './MaintenanceWatcher'

export const metadata = { title: 'Технические работы — AIStart360' }

export default async function MaintenancePage() {
  const m = await getSetting('maintenance', { fresh: true }).catch((e) => {
    console.error('[maintenance] settings read failed:', e instanceof Error ? e.message : e)
    return null
  })
  const active = !!m?.enabled
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A0B0F] px-4 py-10 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center">
        <span className="material-symbols-outlined text-5xl text-[#6effc0]" aria-hidden>{active ? 'construction' : 'check_circle'}</span>
        <h1 className="mt-4 text-2xl font-bold text-white">{active ? 'Ведутся технические работы' : 'Кабинет снова доступен'}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          {active ? (m?.message || 'Кабинет скоро снова будет доступен.') : 'Работы завершены — можно продолжать.'}
        </p>
        {active && m?.until && <p className="mt-2 text-sm text-slate-300">Ожидаемое окончание: {m.until}</p>}
        <MaintenanceWatcher active={active} />
        {/* Plain links: a full page load always re-checks access in middleware. */}
        <div className="mt-6 flex justify-center gap-3">
          {active ? (
            <a href="/maintenance" className="rounded-full border border-white/[0.12] px-5 py-2.5 text-sm font-semibold hover:bg-white/[0.05]">Проверить снова</a>
          ) : (
            <a href="/client/home" className="rounded-full bg-[#6effc0] px-5 py-2.5 text-sm font-bold text-[#003824]">Открыть кабинет</a>
          )}
        </div>
      </div>
    </main>
  )
}
