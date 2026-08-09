'use client'

/**
 * InsightsEmptyState — an empty state that says what is missing and where to
 * go and fix it.
 *
 * `components/common/EmptyState` keeps the base layout (icon, title, copy); its
 * `action` prop takes an `onClick`, which a server component cannot pass and
 * which cannot be a link anyway. So the CTAs are rendered here as real
 * `<Link>`s, and the list of missing inputs is spelled out instead of the usual
 * «данных нет».
 */

import Link from 'next/link'

import { EmptyState } from '@/components/common/EmptyState'

export interface EmptyStateAction {
  href: string
  label: string
  icon: string
  /** One line explaining what filling this in unlocks. */
  hint?: string
  primary?: boolean
}

interface Props {
  icon: string
  title: string
  description: string
  /** Concrete inputs the screen needs and does not have. */
  missing?: string[]
  actions: EmptyStateAction[]
}

export function InsightsEmptyState({ icon, title, description, missing, actions }: Props) {
  return (
    <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low">
      <EmptyState icon={icon} title={title} description={description} className="pb-8" />

      {missing && missing.length > 0 && (
        <div className="mx-auto max-w-lg px-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
            Чего не хватает
          </p>
          <ul className="space-y-1.5">
            {missing.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-on-surface-variant">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[16px] text-tertiary-container mt-0.5 flex-shrink-0"
                >
                  remove
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-stretch justify-center gap-3 px-6 py-8">
        {actions.map((action) => (
          <Link
            key={action.href + action.label}
            href={action.href}
            aria-label={action.hint ? `${action.label}. ${action.hint}` : action.label}
            className={`group inline-flex max-w-xs flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              action.primary
                ? 'border-primary/40 bg-primary/10 hover:bg-primary/15'
                : 'border-white/[0.08] bg-transparent hover:border-white/20'
            }`}
          >
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                action.primary ? 'text-primary' : 'text-on-surface'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                {action.icon}
              </span>
              {action.label}
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[14px] opacity-0 transition-opacity group-hover:opacity-70"
              >
                arrow_forward
              </span>
            </span>
            {action.hint && (
              <span className="text-[11px] leading-snug text-on-surface-variant">{action.hint}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}

export default InsightsEmptyState
