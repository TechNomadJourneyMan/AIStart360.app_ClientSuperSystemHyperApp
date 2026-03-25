import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-mono uppercase text-[10px] tracking-wider border px-2.5 py-1',
  {
    variants: {
      variant: {
        default:   'bg-surface-container text-on-surface-variant border-outline-variant/30',
        primary:   'bg-primary/10 text-primary border-primary/20',
        success:   'bg-primary/10 text-primary border-primary/20',
        warning:   'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
        error:     'bg-error/10 text-error border-error/20',
        secondary: 'bg-secondary/10 text-secondary border-secondary/20',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

export function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
