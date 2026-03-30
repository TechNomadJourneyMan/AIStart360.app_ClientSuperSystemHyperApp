import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'line' | 'block' | 'circle' | 'card'
  lines?: number
}

export function Skeleton({ variant = 'block', lines = 3, className, ...props }: SkeletonProps) {
  if (variant === 'line') {
    return (
      <div className={cn('skeleton h-4 rounded', className)} {...props} />
    )
  }

  if (variant === 'circle') {
    return (
      <div className={cn('skeleton rounded-full aspect-square', className)} {...props} />
    )
  }

  if (variant === 'card') {
    return (
      <div className={cn('bg-surface-container rounded-xl p-5 space-y-3', className)} {...props}>
        <div className="skeleton h-4 rounded w-1/3" />
        <div className="skeleton h-8 rounded w-2/3" />
        <div className="skeleton h-3 rounded w-1/4" />
      </div>
    )
  }

  // block — multiple lines
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-4 rounded"
          style={{ width: i === lines - 1 ? '75%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function KpiBlockSkeleton() {
  return (
    <div className="bg-surface-container-low p-5 rounded-xl">
      <div className="skeleton h-3 rounded w-24 mb-3" />
      <div className="skeleton h-8 rounded w-20 mb-2" />
      <div className="skeleton h-3 rounded w-12" />
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <div className="skeleton h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3.5 rounded w-48" />
            <div className="skeleton h-3 rounded w-32" />
          </div>
          <div className="skeleton h-6 rounded w-16" />
          <div className="skeleton h-6 rounded w-20" />
        </div>
      ))}
    </div>
  )
}
