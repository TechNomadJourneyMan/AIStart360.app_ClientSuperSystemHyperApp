import { historyLine, surveyStatusChips, type SurveyChipTone, type SurveyStaffStatus } from '@/lib/survey/staff-status'

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

/**
 * «Способ заполнения» in the questionnaire tab (spec §10: «значок режима и дата
 * выбора, история переключений»): the chips and the switches, newest first.
 */
export function SurveyModeHistory({ status, now }: { status: SurveyStaffStatus | null | undefined; now?: Date }) {
  if (!status || (!status.mode && !status.express && !status.history.length)) return null
  return (
    <section aria-labelledby="survey-mode-history" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 id="survey-mode-history" className="mb-2 text-xs font-semibold text-on-surface">Способ заполнения</h3>
      <SurveyStatusChips status={status} now={now} />
      {status.history.length > 0 && (
        <ol aria-label="История выбора способа" className="mt-3 space-y-1 text-[11px] text-on-surface-variant">
          {status.history.map((h) => <li key={`${h.at}-${h.mode}`}>{historyLine(h, now)}</li>)}
        </ol>
      )}
    </section>
  )
}
