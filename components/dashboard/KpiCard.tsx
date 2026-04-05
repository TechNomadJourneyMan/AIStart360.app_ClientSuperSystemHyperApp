import Link from 'next/link'

type KpiCardProps = {
  label: string
  value: string
  trend: string
  trendUp: boolean
  icon: string
  sublabel: string
  href: string
}

export function KpiCard({ label, value, trend, trendUp, icon, sublabel, href }: KpiCardProps) {
  return (
    <Link
      href={href}
      className={`
        relative bg-surface-container-low rounded-2xl p-5 overflow-hidden
        border border-white/[0.04] hover:border-primary/20
        transition-all duration-200 group cursor-pointer
        ${!trendUp ? 'hover:border-error/20' : ''}
      `}
    >
      <div
        className={`
          absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl
          ${trendUp
            ? 'bg-gradient-to-br from-primary/[0.04] to-transparent'
            : 'bg-gradient-to-br from-error/[0.04] to-transparent'
          }
        `}
      />
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
          {label}
        </p>
        <span className={`material-symbols-outlined text-base opacity-40 ${trendUp ? 'text-primary' : 'text-error'}`}>
          {icon}
        </span>
      </div>
      <h3 className="text-3xl font-mono font-bold leading-none mb-2 text-on-surface">
        {value}
      </h3>
      <div className="flex items-center gap-1.5">
        <span className={`material-symbols-outlined text-sm ${trendUp ? 'text-primary' : 'text-error'}`}>
          {trendUp ? 'trending_up' : 'trending_down'}
        </span>
        <span className={`text-xs font-mono ${trendUp ? 'text-primary' : 'text-error'}`}>
          {trend}
        </span>
        <span className="text-[10px] text-on-surface-variant ml-1">{sublabel}</span>
      </div>
      <span className="material-symbols-outlined text-sm absolute bottom-4 right-4 opacity-0 group-hover:opacity-40 transition-opacity text-on-surface-variant">
        arrow_forward
      </span>
    </Link>
  )
}
