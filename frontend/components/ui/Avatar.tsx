import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizes = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
}

// Simple hash for consistent color per name
function nameToColor(name: string): string {
  const colors = [
    'bg-primary/20 text-primary',
    'bg-secondary/20 text-secondary',
    'bg-tertiary-container/20 text-tertiary-container',
    'bg-error/20 text-error',
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold flex-shrink-0 overflow-hidden border border-outline-variant/20',
        sizes[size],
        !src && nameToColor(name),
        className
      )}
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="font-label">{initials(name)}</span>
      )}
    </div>
  )
}

export function AvatarGroup({ names, max = 3 }: { names: string[]; max?: number }) {
  const visible = names.slice(0, max)
  const overflow = names.length - max

  return (
    <div className="flex -space-x-2">
      {visible.map((name) => (
        <Avatar key={name} name={name} size="sm" className="ring-2 ring-surface-container" />
      ))}
      {overflow > 0 && (
        <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-mono text-on-surface-variant ring-2 ring-surface-container">
          +{overflow}
        </div>
      )}
    </div>
  )
}
