export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { visiblePagesFor } from '@/lib/cms/server'

export const metadata = { title: 'Материалы — AIStart360' }

export default async function ContentListPage() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) redirect('/login?from=/client/content')
  const pages = await visiblePagesFor(user.id)
  const groups = new Map<string, typeof pages>()
  for (const p of pages) {
    const k = p.category || 'Материалы'
    groups.set(k, [...(groups.get(k) ?? []), p])
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/client/home" className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary">
        <span className="material-symbols-outlined text-sm" aria-hidden>arrow_back</span> Мой профиль
      </Link>
      <h1 className="mt-3 font-headline text-3xl font-black text-on-surface">Материалы</h1>
      <p className="mt-1 text-sm text-on-surface-variant">Обучение и полезные материалы для роста бизнеса.</p>

      {pages.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-white/10 px-6 py-12 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40" aria-hidden>menu_book</span>
          <p className="mt-2 text-sm text-on-surface">Материалы скоро появятся</p>
          <p className="mt-1 text-xs text-on-surface-variant">Мы добавим их сюда, как только они будут готовы.</p>
        </div>
      ) : (
        Array.from(groups.entries()).map(([category, list]) => (
          <section key={category} className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-on-surface">{category}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <Link key={p.id} href={`/client/content/${p.slug}`} className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-primary/25">
                  {p.cover_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover_url} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                  )}
                  <div className="p-4">
                    <span className="material-symbols-outlined text-xl text-primary" aria-hidden>{p.icon || 'article'}</span>
                    <p className="mt-2 text-sm font-semibold text-on-surface group-hover:text-primary">{p.title}</p>
                    {p.summary && <p className="mt-1 line-clamp-3 text-xs leading-snug text-on-surface-variant">{p.summary}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}
