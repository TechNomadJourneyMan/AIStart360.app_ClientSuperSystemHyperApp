import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: string
  rightIcon?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftIcon, rightIcon, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-xl pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full bg-surface-container border border-outline-variant/30 rounded-lg py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40',
              'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              leftIcon  ? 'pl-10 pr-4' : 'px-4',
              rightIcon ? 'pr-10' : '',
              error ? 'border-error/50 focus:border-error/70 focus:ring-error/20' : '',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-xl pointer-events-none">
              {rightIcon}
            </span>
          )}
        </div>
        {error && <p className="text-error text-xs mt-1.5">{error}</p>}
        {hint && !error && <p className="text-on-surface-variant text-xs mt-1.5">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { Input }
