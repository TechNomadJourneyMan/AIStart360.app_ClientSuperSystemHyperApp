export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { publishedPageFor } from '@/lib/cms/server'
import { BlockRenderer } from '@/components/content/BlockRenderer'
import ContentTracker from '@/components/content/ContentTracker'

export default async function ContentPage({ params }: { params: { slug: string } }) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) redirect(`/login?from=/client/content/${params.slug}`)
  const loaded = await publishedPageFor(params.slug, user.id)
  // Hidden and missing pages look the same: no hint that a page exists.
  if (!loaded) notFound()
  const { page, blocks } = loaded

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/client/content" className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary">
        <span className="material-symbols-outlined text-sm" aria-hidden>arrow_back</span> Все материалы
      </Link>
      {page.category && <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-primary/80">{page.category}</p>}
      <h1 className="mt-1 font-headline text-3xl font-black leading-tight text-on-surface sm:text-4xl">{page.title}</h1>
      {page.summary && <p className="mt-2 text-base text-on-surface-variant">{page.summary}</p>}
      {page.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.cover_url} alt="" className="mt-6 w-full rounded-3xl border border-white/[0.06] object-cover" />
      )}
      <div className="mt-8">
        <BlockRenderer blocks={blocks} />
      </div>
      <ContentTracker slug={page.slug} pageId={page.id} />
    </main>
  )
}
