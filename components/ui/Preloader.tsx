import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * Brand preloader — three concentric rings spinning at different speeds
 * (the middle one reversed) with a pulsing logo, mirroring the loader on
 * aistart360.app. Uses portal brand tokens (primary / primary-container /
 * primary-fixed) instead of the landing's neon green.
 *
 * Motion is disabled under `prefers-reduced-motion` (Tailwind `motion-reduce:`
 * variants): rings freeze and the logo stops pulsing, so the mark stays
 * legible without movement. Pure CSS — safe in Server Components.
 *
 * Usage:
 *   <Preloader />                          // inline, md
 *   <Preloader size="sm" label="Загрузка…" />
 *   <FullscreenPreloader label="Готовим вашу диагностику…" />
 */

const SIZES = {
  sm: { box: 'w-12 h-12', inset1: 'inset-[3px]', inset2: 'inset-[7px]', logo: 20, border: 'border-2' },
  md: { box: 'w-24 h-24', inset1: 'inset-[6px]', inset2: 'inset-[16px]', logo: 36, border: 'border-[3px]' },
  lg: { box: 'w-32 h-32', inset1: 'inset-[8px]', inset2: 'inset-[20px]', logo: 48, border: 'border-4' },
} as const

export type PreloaderSize = keyof typeof SIZES

export function Preloader({
  size = 'md',
  label,
  className,
}: {
  size?: PreloaderSize
  label?: string
  className?: string
}) {
  const s = SIZES[size]
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-4', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={cn('relative', s.box)}>
        {/* Outer ring */}
        <div
          className={cn(
            'absolute inset-0 rounded-full border-transparent border-t-primary',
            s.border,
            'animate-ring-spin-slow motion-reduce:animate-none',
          )}
        />
        {/* Middle ring — reversed */}
        <div
          className={cn(
            'absolute rounded-full border-transparent border-t-primary-container',
            s.inset1,
            s.border,
            'animate-ring-spin-med motion-reduce:animate-none',
          )}
        />
        {/* Inner ring — fastest */}
        <div
          className={cn(
            'absolute rounded-full border-transparent border-t-primary-fixed',
            s.inset2,
            s.border,
            'animate-ring-spin-fast motion-reduce:animate-none',
          )}
        />
        {/* Center logo */}
        <div className="absolute inset-0 flex items-center justify-center animate-logo-pulse motion-reduce:animate-none motion-reduce:opacity-100">
          <Image
            src="/logo-icon.svg"
            alt=""
            aria-hidden="true"
            width={s.logo}
            height={s.logo}
            priority
            className="w-auto"
            style={{ height: s.logo }}
          />
        </div>
      </div>
      {label && <p className="text-sm text-on-surface-variant font-label">{label}</p>}
      <span className="sr-only">Загрузка…</span>
    </div>
  )
}

/**
 * Full-viewport overlay preloader. Use for route transitions and long blocking
 * operations (>2s). Keeps the dark background so there is no white flash.
 */
export function FullscreenPreloader({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      <Preloader size="lg" label={label} />
    </div>
  )
}
