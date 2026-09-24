'use client'

/**
 * Экспертная GRI-заметка к блоку — ТОЛЬКО ЧТЕНИЕ.
 *
 * Раньше панель сама решала, кто «эксперт», по `profiles.role` (manager /
 * analyst, но не expert и не SuperExpert из staff_roles) и давала писать в
 * `survey_answers` (`gri_expert_<block>`). Экспертная работа переехала в
 * User 360 кабинета SuperExpert / GIGA-CRM (вкладки «Комментарии» и
 * «Заметки», права из lib/admin/rbac.ts), поэтому здесь остаётся показ уже
 * сохранённой заметки. `userRole` оставлен для совместимости вызовов.
 */

interface ExpertNotesPanelProps {
  blockId: string
  blockLabel: string
  userId: string
  userRole?: string | null
  initialNote?: string
}

export default function ExpertNotesPanel({ blockLabel, initialNote }: ExpertNotesPanelProps) {
  const note = (initialNote ?? '').trim()
  if (!note) return null

  return (
    <div className="mt-4 border-t border-white/[0.04] pt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-sm text-secondary/70">edit_note</span>
        <p className="text-[10px] font-mono text-secondary/70 uppercase tracking-widest">
          Заметка эксперта &mdash; {blockLabel}
        </p>
      </div>
      <div className="bg-surface-container rounded-xl px-4 py-3">
        <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">{note}</p>
      </div>
    </div>
  )
}
