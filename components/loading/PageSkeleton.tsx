/**
 * Skeletons for `loading.tsx` files (PO 2026-10-22, п. 3: show that the page is
 * loading, not frozen). Server components, no data, design tokens only.
 *
 * Every skeleton is a polite live region with a spoken label, so screen
 * readers hear «Загрузка…» instead of silence. The pulse respects
 * prefers-reduced-motion (motion-safe + the global rule in globals.css).
 */
import { cn } from '@/lib/utils'

export type SkeletonVariant = 'dashboard' | 'list' | 'form' | 'article' | 'tabs'

const BLOCK = 'rounded-2xl bg-surface-container-low motion-safe:animate-pulse'

function Status({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>
}

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case 'list':
      return (
        <div className="space-y-3">
          <div className={cn(BLOCK, 'h-10 w-full max-w-md')} />
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn(BLOCK, 'h-16')} />)}
        </div>
      )
    case 'form':
      return (
        <div className="space-y-4">
          <div className={cn(BLOCK, 'h-16')} />
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn(BLOCK, 'h-8 w-24 rounded-lg')} />)}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className={cn(BLOCK, 'h-4 w-48 rounded')} />
              <div className={cn(BLOCK, 'h-12 rounded-xl')} />
            </div>
          ))}
        </div>
      )
    case 'article':
      return (
        <div className="space-y-4">
          <div className={cn(BLOCK, 'h-9 w-2/3 rounded-xl')} />
          <div className={cn(BLOCK, 'h-5 w-1/2 rounded')} />
          <div className={cn(BLOCK, 'h-56 rounded-3xl')} />
          {[0, 1, 2].map((i) => <div key={i} className={cn(BLOCK, 'h-4 rounded')} />)}
        </div>
      )
    case 'tabs':
      return (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn(BLOCK, 'h-9 w-28 shrink-0 rounded-xl')} />)}
          </div>
          <div className={cn(BLOCK, 'h-28')} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className={cn(BLOCK, 'h-24')} />)}
          </div>
          <div className={cn(BLOCK, 'h-64')} />
        </div>
      )
    case 'dashboard':
    default:
      return (
        <div className="space-y-4">
          <div className={cn(BLOCK, 'h-40 rounded-3xl')} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className={cn(BLOCK, 'h-24')} />)}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn(BLOCK, 'h-36')} />)}
          </div>
        </div>
      )
  }
}

/** A cabinet page skeleton (inside the client shell or the expert portal). */
export function PageSkeleton({
  label = 'Загрузка страницы…',
  variant = 'dashboard',
  width = 'max-w-6xl',
}: { label?: string; variant?: SkeletonVariant; width?: string }) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6', width)} role="status" aria-live="polite" aria-busy="true">
      <Status label={label} />
      <Body variant={variant} />
    </div>
  )
}

/** Full-screen variant for flows without the shell (welcome, waiting room, AI Journey). */
export function ScreenSkeleton({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6" role="status" aria-live="polite" aria-busy="true">
      <Status label={label} />
      <div className="w-full max-w-lg space-y-4">
        <div className={cn(BLOCK, 'mx-auto h-16 w-16 rounded-full')} />
        <div className={cn(BLOCK, 'mx-auto h-6 w-48 rounded')} />
        <div className={cn(BLOCK, 'mx-auto h-4 w-64 rounded')} />
        {[0, 1, 2].map((i) => <div key={i} className={cn(BLOCK, 'h-12 rounded-xl')} />)}
      </div>
    </div>
  )
}

/**
 * GIGA-CRM / SuperExpert screens: the panel draws on its own dark canvas, so
 * the blocks are translucent (same as the sidebar's loading rows).
 */
export function PanelSkeleton({ label = 'Загрузка раздела…', variant = 'list' }: { label?: string; variant?: 'list' | 'detail' }) {
  const block = 'rounded-2xl bg-white/[0.04] motion-safe:animate-pulse'
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <Status label={label} />
      <div className={cn(block, 'h-8 w-56 rounded-xl')} />
      {variant === 'detail' ? (
        <>
          <div className={cn(block, 'h-32')} />
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className={cn(block, 'h-9 w-28 shrink-0 rounded-xl')} />)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className={cn(block, 'h-40')} />)}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className={cn(block, 'h-20')} />)}
          </div>
          <div className={cn(block, 'h-10')} />
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn(block, 'h-14 rounded-xl')} />)}
        </>
      )}
    </div>
  )
}
