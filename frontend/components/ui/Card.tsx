import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'raised'
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

export function Card({ className, variant = 'default', padding = 'md', children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl transition-colors',
        {
          'bg-surface-container': variant === 'default',
          'glass-card': variant === 'glass',
          'bg-surface-container-high': variant === 'raised',
        },
        {
          'p-4': padding === 'sm',
          'p-5 md:p-6': padding === 'md',
          'p-6 md:p-8': padding === 'lg',
          '': padding === 'none',
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  action?: React.ReactNode
}

export function CardHeader({ title, description, action, className, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between mb-5', className)} {...props}>
      <div>
        <h3 className="font-headline text-lg font-bold text-on-surface">{title}</h3>
        {description && <p className="text-sm text-on-surface-variant mt-0.5">{description}</p>}
      </div>
      {action && <div className="flex-shrink-0 ml-4">{action}</div>}
    </div>
  )
}
