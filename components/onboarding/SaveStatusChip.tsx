'use client'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const VIEW: Record<Exclude<SaveState, 'idle'>, { icon: string; tone: string; spin?: boolean }> = {
  dirty: { icon: 'edit', tone: 'text-on-surface-variant' },
  saving: { icon: 'progress_activity', tone: 'text-on-surface-variant', spin: true },
  saved: { icon: 'cloud_done', tone: 'text-primary/80' },
  error: { icon: 'cloud_off', tone: 'text-error' },
}

function label(state: Exclude<SaveState, 'idle'>, savedAt: Date | null): string {
  if (state === 'dirty') return 'Есть изменения'
  if (state === 'saving') return 'Сохранение…'
  if (state === 'error') return 'Не сохранено — повторим'
  const t = savedAt ? savedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
  return t ? `Сохранено · ${t}` : 'Сохранено'
}

/** Small header indicator of the survey's server-save state. */
export default function SaveStatusChip({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  if (state === 'idle') return null
  const v = VIEW[state]
  return (
    <span aria-live="polite" className={`flex items-center gap-1 text-[10px] font-mono whitespace-nowrap ${v.tone}`}>
      <span className={`material-symbols-outlined text-sm ${v.spin ? 'animate-spin' : ''}`}>{v.icon}</span>
      <span className="hidden sm:inline">{label(state, savedAt)}</span>
    </span>
  )
}
