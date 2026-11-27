import Link from 'next/link'
import { storeHref } from '@/lib/store/links'
import type { StoreAccessError } from '@/lib/store/request'

export function StoreAccessNotice({ error, path }: { error: StoreAccessError; path: string }) {
  return (
    <section className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-surface-container-low p-6">
      <h1 className="font-headline text-2xl font-bold text-on-surface">Магазин</h1>
      <p className="text-on-surface-variant">{error.message}</p>
      {error.accounts && (
        <ul className="space-y-2">
          {error.accounts.map((account) => (
            <li key={account.id}>
              <Link href={storeHref(path, account.id)} className="block rounded-lg border border-white/10 px-4 py-3 text-primary hover:border-primary/40">
                {account.name || 'Компания без названия'}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error.code === 'mfa_step_up_required' && <Link href={`/2fa?from=${encodeURIComponent(path)}`} className="inline-block text-primary">Подтвердить вход</Link>}
      {error.code === 'company_not_found' && <Link href="/client/home" className="inline-block text-primary">Открыть личный кабинет</Link>}
    </section>
  )
}
