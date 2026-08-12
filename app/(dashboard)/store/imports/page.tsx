import type { Metadata } from 'next'
import Link from 'next/link'
import StoreImportPreview from '@/components/store/StoreImportPreview'
import { StoreImportHistory } from '@/components/store/StoreImportHistory'
import { loadStoreImportHistory } from '@/lib/store/import/history'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Импорт данных · Магазин · AIStart360',
  description: 'Проверяемая и атомарная публикация XLS, XLSX и CSV в Store Control Center.',
}

export default async function StoreImportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const history = user ? await loadStoreImportHistory(supabase, user.id) : []

  return (
    <div className="space-y-6">
      <nav aria-label="Хлебные крошки" className="flex items-center gap-1.5 text-xs text-on-surface-variant">
        <Link href="/store" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 hover:bg-white/[0.04] hover:text-primary">
          <span className="material-symbols-outlined text-base" aria-hidden="true">storefront</span>
          Магазин
        </Link>
        <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
        <span aria-current="page" className="font-medium text-on-surface">Импорт данных</span>
      </nav>

      <header className="rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.09] via-surface-container-low to-surface-container-low p-5 md:p-7">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-2xl text-primary" aria-hidden="true">
            preview
          </span>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary">Verified store import</p>
            <h1 className="mt-1 font-headline text-2xl font-extrabold text-on-surface md:text-3xl">Проверка и публикация данных</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
              Сначала проверьте структуру и контрольные итоги, затем подтвердите дату и варианты. Сервер повторно проверит исходный файл и опубликует его атомарно.
            </p>
          </div>
        </div>
      </header>

      <StoreImportPreview />
      <StoreImportHistory entries={history} />
    </div>
  )
}
