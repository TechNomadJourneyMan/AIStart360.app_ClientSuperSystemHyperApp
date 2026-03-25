export type AlertSeverity = 'critical' | 'warning' | 'success' | 'info'

export interface AlertCardProps {
  id: string
  severity: AlertSeverity
  title: string
  description: string
  time: string
  action?: { label: string; href: string }
}

const config: Record<AlertSeverity, { border: string; icon: string; iconColor: string; iconFill: boolean }> = {
  critical: { border: 'border-error/50',              icon: 'warning',  iconColor: 'text-error',              iconFill: true },
  warning:  { border: 'border-tertiary-container/50', icon: 'error',    iconColor: 'text-tertiary-container', iconFill: true },
  success:  { border: 'border-primary/50',            icon: 'verified', iconColor: 'text-primary',            iconFill: true },
  info:     { border: 'border-secondary/50',          icon: 'info',     iconColor: 'text-secondary',          iconFill: false },
}

export function AlertCard({ severity, title, description, time, action }: AlertCardProps) {
  const cfg = config[severity]
  return (
    <div className={`bg-surface-container p-6 rounded-xl border-l-4 ${cfg.border} hover:bg-surface-container-high transition-colors`}>
      <div className="flex justify-between items-start mb-4">
        <span
          className={`material-symbols-outlined ${cfg.iconColor}`}
          style={cfg.iconFill ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {cfg.icon}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant">{time}</span>
      </div>
      <h5 className="font-bold text-on-surface text-base mb-1">{title}</h5>
      <p className="text-sm text-on-surface-variant leading-relaxed">{description}</p>
      {action && (
        <a
          href={action.href}
          className="mt-4 inline-block text-[11px] font-mono text-primary uppercase tracking-wider hover:underline"
        >
          {action.label} →
        </a>
      )}
    </div>
  )
}
