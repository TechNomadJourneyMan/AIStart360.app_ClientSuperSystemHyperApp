import Link from 'next/link'

export type AlertSeverity = 'critical' | 'warning' | 'success' | 'info'

export interface AlertCardProps {
  id: string
  severity: AlertSeverity
  title: string
  description: string
  time: string
  action?: { label: string; href: string }
}

const config: Record<AlertSeverity, {
  dot: string
  accent: string
  bg: string
  badge: string
  icon: string
}> = {
  critical: {
    dot: 'bg-error',
    accent: 'border-l-error/60',
    bg: 'from-error/[0.06] to-transparent',
    badge: 'bg-error/10 text-error border-error/20',
    icon: 'warning',
  },
  warning: {
    dot: 'bg-tertiary-container',
    accent: 'border-l-tertiary-container/60',
    bg: 'from-tertiary-container/[0.06] to-transparent',
    badge: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
    icon: 'error',
  },
  success: {
    dot: 'bg-primary',
    accent: 'border-l-primary/60',
    bg: 'from-primary/[0.06] to-transparent',
    badge: 'bg-primary/10 text-primary border-primary/20',
    icon: 'verified',
  },
  info: {
    dot: 'bg-secondary',
    accent: 'border-l-secondary/60',
    bg: 'from-secondary/[0.06] to-transparent',
    badge: 'bg-secondary/10 text-secondary border-secondary/20',
    icon: 'info',
  },
}

export function AlertCard({ severity, title, description, time, action }: AlertCardProps) {
  const cfg = config[severity]
  return (
    <div className={`
      relative group overflow-hidden
      bg-surface-container rounded-2xl border border-white/[0.04]
      border-l-2 ${cfg.accent}
      hover:border-white/[0.08] hover:bg-surface-container-high
      transition-all duration-200 cursor-default
      flex flex-col p-5
    `}>
      {/* Accent gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${cfg.bg} pointer-events-none`} />

      {/* Header */}
      <div className="relative flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${cfg.badge}`}>
            {severity === 'critical' ? 'CRITICAL' : severity === 'warning' ? 'WARNING' : severity === 'success' ? 'SUCCESS' : 'INFO'}
          </span>
        </div>
        <span className="font-mono text-[10px] text-on-surface-variant/60">{time}</span>
      </div>

      {/* Content */}
      <div className="relative flex-1">
        <h5 className="font-headline font-bold text-on-surface text-sm mb-1.5 leading-snug">{title}</h5>
        <p className="text-xs text-on-surface-variant leading-relaxed">{description}</p>
      </div>

      {/* Action */}
      {action && (
        <div className="relative mt-4 pt-3 border-t border-white/[0.04]">
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-primary uppercase tracking-wider hover:gap-2 transition-all"
          >
            {action.label}
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      )}
    </div>
  )
}
