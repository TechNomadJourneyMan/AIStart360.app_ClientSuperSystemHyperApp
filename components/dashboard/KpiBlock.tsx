interface KpiBlockProps {
  label: string
  value: string
  trend?: string
  trendUp?: boolean
  icon?: string
}

export function KpiBlock({ label, value, trend, trendUp = true, icon }: KpiBlockProps) {
  return (
    <div className="bg-surface-container-low p-5 rounded-xl border-b-2 border-transparent hover:border-primary/40 transition-all duration-200 group cursor-default">
      {icon && (
        <span className="material-symbols-outlined text-on-surface-variant/40 text-xl mb-3 block">
          {icon}
        </span>
      )}
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
        {label}
      </p>
      <h3 className="text-3xl font-mono font-bold text-on-surface group-hover:text-primary transition-colors duration-200 animate-count-up">
        {value}
      </h3>
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-mono ${trendUp ? 'text-primary' : 'text-error'}`}>
          <span className="material-symbols-outlined text-sm">
            {trendUp ? 'trending_up' : 'trending_down'}
          </span>
          {trend}
        </div>
      )}
    </div>
  )
}
