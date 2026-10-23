import { surveyStatusChips, type SurveyChipTone, type SurveyStaffStatus } from '@/lib/survey/staff-status'

const TONE: Record<SurveyChipTone, string> = {
  neutral: 'border-white/[0.08] bg-white/[0.04] text-on-surface-variant',
  primary: 'border-primary/25 bg-primary/10 text-primary',
  amber: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
}

/**
 * The questionnaire status for staff (spec §5.2, §10): the mode the client
 * fills in, the express status, whether the full questionnaire is submitted.
 * The same chips in the expert's client list, the client card and GIGA User 360.
 */
export function SurveyStatusChips({ status, size = 'sm', now }: { status: SurveyStaffStatus | null | undefined; size?: 'xs' | 'sm'; now?: Date }) {
  const chips = surveyStatusChips(status, now)
  if (!chips.length) return null
  const text = size === 'xs' ? 'text-[10px]' : 'text-[11px]'
  return (
    <ul aria-label="Анкета: способ заполнения" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={c.key} title={c.title} data-chip={c.key}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${text} ${TONE[c.tone]}`}>
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">{c.icon}</span>
          {c.label}
          {c.title && <span className="sr-only"> ({c.title})</span>}
        </li>
      ))}
    </ul>
  )
}
