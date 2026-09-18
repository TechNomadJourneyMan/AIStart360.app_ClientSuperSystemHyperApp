'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ProfileSection, UserProfileSummary } from '@/lib/user-dashboard/summary'

const PREVIEW_COUNT = 4

function SectionCard({ section }: { section: ProfileSection }) {
  const [open, setOpen] = useState(false)
  const empty = section.answers.length === 0
  const shown = open ? section.answers : section.answers.slice(0, PREVIEW_COUNT)
  const rest = section.answers.length - PREVIEW_COUNT
  const pct = section.total ? Math.round((section.filled / section.total) * 100) : 0

  return (
    <article className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <span className="material-symbols-outlined text-lg text-primary" aria-hidden>{section.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-on-surface">{section.title}</h3>
          <p className="text-xs leading-snug text-on-surface-variant">{section.description}</p>
        </div>
        <Link
          href={`/client/onboarding?step=${section.editStep}`}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-on-surface-variant hover:bg-white/[0.05] hover:text-primary"
          aria-label={`${empty ? 'Заполнить' : 'Изменить'}: ${section.title}`}
        >
          <span className="material-symbols-outlined text-sm" aria-hidden>{empty ? 'add' : 'edit'}</span>
          {empty ? 'Заполнить' : 'Изменить'}
        </Link>
      </header>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[10px] text-on-surface-variant">{section.filled}/{section.total}</span>
      </div>

      {empty ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-on-surface-variant">
          Здесь пока пусто. Ответы этого раздела делают диагностику точнее.
        </p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {shown.map((a) => (
            <div key={a.key} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
              <dt className="text-[11px] leading-snug text-on-surface-variant">{a.label}</dt>
              <dd className={`whitespace-pre-line break-words text-xs leading-snug text-on-surface ${open ? '' : 'line-clamp-3'}`}>{a.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-3 flex items-center gap-1 self-start text-[11px] font-medium text-primary hover:text-primary/80"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden>{open ? 'expand_less' : 'expand_more'}</span>
          {open ? 'Свернуть' : `Показать ещё ${rest}`}
        </button>
      )}
    </article>
  )
}

/** The survey, presented as a business profile grouped by theme (not by wizard step). */
export default function ProfileSections({ summary }: { summary: UserProfileSummary }) {
  return (
    <section id="profile" className="scroll-mt-20" aria-labelledby="profile-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="profile-title" className="text-sm font-semibold text-on-surface">Профиль бизнеса</h2>
        <span className="text-[11px] text-on-surface-variant">по данным вашей анкеты</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {summary.sections.map((s) => <SectionCard key={s.id} section={s} />)}
      </div>
    </section>
  )
}
