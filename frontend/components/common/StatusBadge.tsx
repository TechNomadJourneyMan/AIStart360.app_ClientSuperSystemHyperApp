import { cn } from '@/lib/utils'

export type StatusType = 'success' | 'warning' | 'critical' | 'info' | 'neutral' | 'active' | 'inactive'

interface StatusBadgeProps {
  status: StatusType | string
  label: string
  dot?: boolean
  className?: string
}

const statusConfig: Record<string, { color: string; dotClass: string }> = {
  success:    { color: 'text-primary bg-primary/10 border-primary/20',                                      dotClass: 'bg-primary' },
  active:     { color: 'text-primary bg-primary/10 border-primary/20',                                      dotClass: 'bg-primary' },
  warning:    { color: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',      dotClass: 'bg-tertiary-container' },
  critical:   { color: 'text-error bg-error/10 border-error/20',                                            dotClass: 'bg-error' },
  info:       { color: 'text-secondary bg-secondary/10 border-secondary/20',                                dotClass: 'bg-secondary' },
  neutral:    { color: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30',       dotClass: 'bg-outline' },
  inactive:   { color: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30',       dotClass: 'bg-outline' },
  'at risk':  { color: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',     dotClass: 'bg-tertiary-container' },
  strong:     { color: 'text-primary bg-primary/10 border-primary/20',                                      dotClass: 'bg-primary' },
  developing: { color: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',     dotClass: 'bg-tertiary-container' },
}

function getConfig(status: string) {
  const key = status.toLowerCase()
  return statusConfig[key] ?? statusConfig.neutral
}

export function StatusBadge({ status, label, dot = true, className }: StatusBadgeProps) {
  const cfg = getConfig(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border px-2.5 py-1',
        cfg.color,
        className
      )}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />}
      {label}
    </span>
  )
}
