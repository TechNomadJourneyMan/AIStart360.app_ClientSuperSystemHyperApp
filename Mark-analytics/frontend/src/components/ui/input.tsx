import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-[color:var(--input)] bg-[color:var(--background)]',
          'px-3 py-1 text-sm text-[color:var(--foreground)] shadow-sm outline-none',
          'placeholder:text-[color:var(--muted-foreground)]',
          'focus-visible:border-[color:var(--ring)] focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
