import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
    'transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)]',
  ),
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[color:var(--primary)] text-[color:var(--primary-foreground)]',
        secondary:
          'border-transparent bg-[color:var(--secondary)] text-[color:var(--secondary-foreground)]',
        outline:
          'border-[color:var(--border)] text-[color:var(--foreground)] bg-transparent',
        muted:
          'border-transparent bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
        success:
          'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        info:
          'border-transparent bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
        warn:
          'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        danger:
          'border-transparent bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
export default Badge;
