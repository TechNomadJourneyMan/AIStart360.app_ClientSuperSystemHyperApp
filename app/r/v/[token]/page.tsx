export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { Logo } from '@/components/ui/Logo'
import { ReportDetails } from '@/components/reports/PublishedReports'
import { resolveVersionLink } from '@/lib/reports/version-link'
import { versionDateLabel, versionStamp } from '@/lib/reports/version-stamp'

/**
 * /r/v/<token> — one published report version by a signed, expiring link
 * (lib/reports/version-link.ts): «Версия N · дата», the frozen snapshot with
 * provenance badges, and the PDF of exactly this version. A version waiting
 * for the expert, a rejected or a withdrawn one never opens; every failure
 * shows the same page.
 */
export const metadata: Metadata = { title: 'Отчёт · AIStart360', robots: { index: false, follow: false } }

function InvalidLink() {
  return (
    <main className="min-h-screen bg-[#0A0B0F] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-container rounded-2xl border border-white/[0.06] shadow-card p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-5">
          <span className="material-symbols-outlined text-3xl text-error" aria-hidden="true">link_off</span>
        </div>
        <h1 className="font-headline text-xl font-bold text-on-surface mb-2">Ссылка недействительна или истекла</h1>
        <p className="text-sm text-on-surface-variant">
          Срок действия ссылки закончился, или эта версия отчёта больше недоступна. Актуальный отчёт — в кабинете, раздел «Точка А».
        </p>
      </div>
    </main>
  )
}

export default async function VersionLinkPage({ params }: { params: { token: string } }) {
  const link = await resolveVersionLink(params.token)
  if (!link.ok) return <InvalidLink />
  const v = link.version
  const replaced = v.status !== 'published'
  return (
    <main className="min-h-screen bg-[#0A0B0F] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <Logo />
          <span className="text-[11px] font-mono text-on-surface-variant">ссылка действует до {versionDateLabel(link.expiresAt)}</span>
        </header>
        <section className="rounded-2xl border border-white/[0.06] bg-surface-container p-5 sm:p-6">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">Отчёт специалиста</p>
          <h1 className="mt-2 font-headline text-xl font-bold text-on-surface">{v.title}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {v.company_name ?? 'Компания'} · <span className="font-mono text-on-surface">{versionStamp(v.version, v.created_at)}</span>
          </p>
          {replaced && (
            <p className="mt-2 rounded-xl border border-white/[0.06] bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
              Это более ранняя версия отчёта: специалист с тех пор опубликовал новую. Данные этой версии зафиксированы и не меняются.
            </p>
          )}
          <div className="mt-4">
            <a
              href={`/r/v/${encodeURIComponent(params.token)}/pdf`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-on-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span>
              Скачать PDF · версия {v.version}
            </a>
          </div>
          <ReportDetails content={v.content} />
        </section>
      </div>
    </main>
  )
}
