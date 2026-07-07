import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-semibold text-sm rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary:   'bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-primary-sm hover:scale-[0.98] active:scale-95',
        secondary: 'border border-primary/20 text-primary bg-transparent hover:bg-primary/5',
        ghost:     'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
        danger:    'border border-error/30 text-error bg-transparent hover:bg-error/10',
        outline:   'border border-outline-variant/30 text-on-surface bg-transparent hover:bg-surface-container',
      },
      size: {
        sm:   'px-3 py-1.5 text-xs',
        md:   'px-5 py-2.5',
        lg:   'px-6 py-3 text-base',
        // UX-09: guarantee a >=40px touch target for icon-only buttons.
        icon: 'p-2 min-w-10 min-h-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  leftIcon?: string
  rightIcon?: string
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : leftIcon ? (
          <span className="material-symbols-outlined text-[1.1em]">{leftIcon}</span>
        ) : null}
        {children}
        {rightIcon && !loading && (
          <span className="material-symbols-outlined text-[1.1em]">{rightIcon}</span>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button, buttonVariants }
