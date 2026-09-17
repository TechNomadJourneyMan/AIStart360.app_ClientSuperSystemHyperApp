'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { UserProfileSummary } from '@/lib/user-dashboard/summary'
import ProfileSections from './ProfileSections'
import GriSection from './GriSection'

export interface UserHomeData {
  fullName: string
  email: string
  status: string
  surveyStartedAt: string | null
  surveyUpdatedAt: string | null
  summary: UserProfileSummary
  diagnostics: { overallScore: number | null; stage: string | null; calculatedAt: string | null } | null
  gri: { index: number; assessedAt: string } | null
  documentsCount: number
  sections: Array<{ key: string; title: string; description: string | null; icon: string | null; href: string }>
  materials: Array<{ slug: string; title: string; summary: string | null; icon: string | null }>
  unavailableSection: string | null
}

const STATUS_VIEW: Record<string, { label: string; tone: string }> = {
  approved: { label: 'Доступ открыт', tone: 'text-primary border-primary/30 bg-primary/10' },
  pending_approval: { label: 'На проверке', tone: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  requires_clarification: { label: 'Нужны уточнения', tone: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  rejected: { label: 'Заявка отклонена', tone: 'text-red-400 border-red-400/30 bg-red-400/10' },
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

function Stat({ icon, label, value, hint }: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <span className="material-symbols-outlined text-base" aria-hidden>{icon}</span>
        <span className="text-[11px] uppercase tracking-[0.08em]">{label}</span>
      </div>
      <p className="mt-2 line-clamp-2 break-words text-base font-bold leading-tight text-on-surface tabular-nums sm:text-xl" title={value}>{value}</p>
      {hint && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-on-surface-variant">{hint}</p>}
    </div>
  )
}

export default function UserHome({ data }: { data: UserHomeData }) {
  const router = useRouter()
  const { summary } = data
  const { hero } = summary
  const status = STATUS_VIEW[data.status] ?? STATUS_VIEW.pending_approval
  const approved = data.status === 'approved'
  const title = hero.company || data.fullName || 'Ваш профиль'
  const facts = [hero.industry, hero.businessModel, hero.employees && `${hero.employees} сотр.`, hero.regions].filter(Boolean) as string[]
  const surveyDone = summary.missingSteps.length === 0

  const logout = async () => {
    await createClient().auth.signOut()
    router.push('/login')
  }

  const readyByKey: Record<string, boolean> = {
    point_a: data.diagnostics != null,
    documents: data.documentsCount > 0,
  }
  const nextLinks = data.sections.map((sec) => ({
    href: sec.href,
    icon: sec.icon || 'arrow_forward',
    title: sec.title,
    text: sec.key === 'documents' && data.documentsCount ? `Загружено файлов: ${data.documentsCount}` : sec.description ?? '',
    ready: readyByKey[sec.key] ?? false,
    open: sec.key === 'documents' || sec.key === 'content',
  }))

  return (
    <div className="min-h-screen text-on-surface">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0A0B0F]/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/client/home" className="flex items-center gap-2">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} priority />
            <span className="hidden text-sm font-bold text-on-surface/80 sm:block">AIStart360</span>
          </Link>
          <nav className="flex items-center gap-1 text-xs" aria-label="Разделы">
            <a href="#profile" className="rounded-lg px-2.5 py-1.5 text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface">Анкета</a>
            <a href="#gri" className="rounded-lg px-2.5 py-1.5 text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface">GRI</a>
            {approved && (
              <Link href="/dashboard" className="rounded-lg px-2.5 py-1.5 text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface">Кабинет</Link>
            )}
            <button type="button" onClick={logout} className="ml-1 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface">
              <span className="material-symbols-outlined text-sm" aria-hidden>logout</span>
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {data.unavailableSection && (
          <p role="status" className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-200">
            Этот раздел сейчас недоступен для вашего аккаунта. Если он нужен — напишите нам, мы поможем.
          </p>
        )}

        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/[0.08] blur-[90px]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.tone}`}>{status.label}</span>
                <span className="text-[11px] text-on-surface-variant">
                  Анкета: {data.surveyStartedAt ? `заполнена ${fmtDate(data.surveyStartedAt)}` : 'не начата'}
                  {data.surveyUpdatedAt && fmtDate(data.surveyUpdatedAt) !== fmtDate(data.surveyStartedAt) ? ` · обновлена ${fmtDate(data.surveyUpdatedAt)}` : ''}
                </span>
              </div>
              <h1 className="mt-3 line-clamp-2 break-words font-headline text-2xl font-black sm:text-3xl">{title}</h1>
              <p className="mt-1 text-sm text-on-surface-variant">
                {facts.length ? facts.join(' · ') : 'Расскажите о компании — и здесь появится её профиль.'}
              </p>
              {(hero.contact || data.email) && (
                <p className="mt-1 text-xs text-on-surface-variant/70">{[hero.contact || data.fullName, data.email].filter(Boolean).join(' · ')}</p>
              )}
            </div>

            <div className="w-full shrink-0 lg:w-72">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-on-surface-variant">Анкета заполнена</span>
                <span className="font-mono text-on-surface">{summary.startedSteps}/{summary.totalSteps} · {summary.percent}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent} aria-label="Заполнено анкеты">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#00e29e]" style={{ width: `${summary.percent}%` }} />
              </div>
              <Link
                href={surveyDone ? '/client/onboarding' : `/client/onboarding?step=${summary.missingSteps[0]}`}
                className={`mt-3 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  surveyDone
                    ? 'border border-white/[0.08] text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface'
                    : 'bg-gradient-to-r from-primary to-[#00e29e] text-[#003824]'
                }`}
              >
                <span className="material-symbols-outlined text-base" aria-hidden>{surveyDone ? 'edit' : 'arrow_forward'}</span>
                {summary.isEmpty ? 'Заполнить анкету' : surveyDone ? 'Изменить ответы' : 'Дозаполнить анкету'}
              </Link>
            </div>
          </div>
        </section>

        {/* Key numbers */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ключевые показатели">
          <Stat icon="payments" label="Выручка" value={hero.revenue || '—'} hint="из анкеты" />
          <Stat icon="flag" label="Цель · 12 мес" value={hero.goal12m || '—'} hint={hero.goal3y ? `3 года: ${hero.goal3y}` : undefined} />
          <Stat
            icon="my_location"
            label="Точка А"
            value={data.diagnostics?.overallScore != null ? `${Math.round(data.diagnostics.overallScore)} / 100` : '—'}
            hint={data.diagnostics?.calculatedAt ? `расчёт ${fmtDate(data.diagnostics.calculatedAt)}` : 'появится после анкеты'}
          />
          <Stat
            icon="radar"
            label="GRI"
            value={data.gri ? `${data.gri.index.toFixed(1)} / 10` : '—'}
            hint={data.gri ? `оценка ${fmtDate(data.gri.assessedAt)}` : 'диагностика не пройдена'}
          />
        </section>

        <ProfileSections summary={summary} />

        <GriSection />

        {data.materials.length > 0 && (
          <section aria-labelledby="materials-title">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="materials-title" className="text-sm font-semibold text-on-surface">Материалы для вас</h2>
              <Link href="/client/content" className="text-xs text-primary hover:underline">Все материалы</Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.materials.map((m) => (
                <Link key={m.slug} href={`/client/content/${m.slug}`} className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-primary/25">
                  <span className="material-symbols-outlined text-xl text-primary" aria-hidden>{m.icon || 'article'}</span>
                  <p className="mt-2 text-sm font-semibold text-on-surface group-hover:text-primary">{m.title}</p>
                  {m.summary && <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">{m.summary}</p>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Where to go next */}
        <section aria-labelledby="next-title">
          <h2 id="next-title" className="mb-3 text-sm font-semibold text-on-surface">Что дальше</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {nextLinks.map((l) => {
              const locked = !approved && !l.open
              const body = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="material-symbols-outlined text-xl text-primary" aria-hidden>{l.icon}</span>
                    <span className="material-symbols-outlined text-base text-on-surface-variant/50 group-hover:text-primary" aria-hidden>
                      {locked ? 'lock' : l.ready ? 'check_circle' : 'arrow_forward'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-on-surface">{l.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-on-surface-variant">{locked ? 'Откроется после подтверждения доступа' : l.text}</p>
                </>
              )
              return locked ? (
                <div key={l.href} className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-4 opacity-70">{body}</div>
              ) : (
                <Link key={l.href} href={l.href} className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-primary/25 hover:bg-white/[0.04]">{body}</Link>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
