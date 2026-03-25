# AIStart360 — Design System Reference

> Единый источник правды для дизайна и верстки

---

## Tailwind Config (готовый к использованию)

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // === BRAND PALETTE ===
        primary:                    '#6effc0',
        'primary-container':        '#00e5a0',
        'primary-fixed':            '#47ffb8',
        'primary-fixed-dim':        '#00e29e',
        'on-primary':               '#003824',
        'on-primary-container':     '#006141',
        'on-primary-fixed':         '#002114',
        'on-primary-fixed-variant': '#005236',
        'inverse-primary':          '#006c49',
        'surface-tint':             '#00e29e',

        // === SECONDARY ===
        secondary:                    '#bcc7de',
        'secondary-container':        '#3e495d',
        'secondary-fixed':            '#d8e3fb',
        'secondary-fixed-dim':        '#bcc7de',
        'on-secondary':               '#263143',
        'on-secondary-container':     '#aeb9d0',
        'on-secondary-fixed':         '#111c2d',
        'on-secondary-fixed-variant': '#3c475a',

        // === TERTIARY (amber/warm) ===
        tertiary:                    '#ffe1bd',
        'tertiary-container':        '#ffbd60',
        'tertiary-fixed':            '#ffddb4',
        'tertiary-fixed-dim':        '#ffb955',
        'on-tertiary':               '#452b00',
        'on-tertiary-container':     '#754b00',
        'on-tertiary-fixed':         '#291800',
        'on-tertiary-fixed-variant': '#633f00',

        // === ERROR ===
        error:                 '#ffb4ab',
        'error-container':     '#93000a',
        'on-error':            '#690005',
        'on-error-container':  '#ffdad6',

        // === SURFACES ===
        background:                    '#0A0B0F',
        surface:                       '#121317',
        'surface-dim':                 '#121317',
        'surface-bright':              '#38393e',
        'surface-container-lowest':    '#0d0e12',
        'surface-container-low':       '#1a1b20',
        'surface-container':           '#1f1f24',
        'surface-container-high':      '#292a2e',
        'surface-container-highest':   '#343439',
        'surface-variant':             '#343439',

        // === TEXT / ON COLORS ===
        'on-surface':          '#e3e2e8',
        'on-surface-variant':  '#bacbbf',
        'on-background':       '#e3e2e8',
        'inverse-surface':     '#e3e2e8',
        'inverse-on-surface':  '#2f3035',

        // === OUTLINES ===
        outline:           '#84958a',
        'outline-variant':  '#3b4a41',
      },

      fontFamily: {
        headline: ['Bricolage Grotesque', 'Space Grotesk', 'sans-serif'],
        body:     ['DM Sans', 'Inter', 'sans-serif'],
        label:    ['Space Grotesk', 'DM Sans', 'sans-serif'],
        mono:     ['JetBrains Mono', 'monospace'],
      },

      borderRadius: {
        DEFAULT: '0.25rem',   // 4px
        lg:      '0.5rem',    // 8px
        xl:      '0.75rem',   // 12px
        '2xl':   '1rem',      // 16px
        full:    '9999px',
      },

      boxShadow: {
        'primary-sm': '0 2px 8px rgba(110, 255, 192, 0.08)',
        'primary-md': '0 4px 16px rgba(110, 255, 192, 0.12)',
        'card':       '0 2px 12px rgba(0, 0, 0, 0.4)',
        'modal':      '0 8px 40px rgba(0, 0, 0, 0.6)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
}

export default config
```

---

## CSS Variables + Google Fonts (globals.css)

```css
/* app/globals.css */
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: dark;
  }

  html {
    @apply dark;
  }

  body {
    background-color: #0A0B0F;
    color: #e3e2e8;
  }

  .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    vertical-align: middle;
  }

  /* Убрать scrollbar но сохранить функциональность */
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
}

@layer components {
  /* Glassmorphism card */
  .glass-panel {
    background: rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .glass-card {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  /* Noise texture overlay */
  .noise-overlay {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    opacity: 0.05;
  }

  /* Shimmer loading skeleton */
  .skeleton {
    @apply bg-surface-container-high rounded animate-pulse;
  }

  .shimmer {
    background: linear-gradient(
      90deg,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,0.04) 50%,
      rgba(255,255,255,0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
}
```

---

## Компоненты React (готовые snippets)

### StatusBadge.tsx

```tsx
interface StatusBadgeProps {
  status: 'critical' | 'warning' | 'success' | 'info' | 'neutral'
  label: string
}

const statusConfig = {
  critical: 'bg-error/10 text-error border-error/20',
  warning:  'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
  success:  'bg-primary/10 text-primary border-primary/20',
  info:     'bg-secondary/10 text-secondary border-secondary/20',
  neutral:  'bg-outline/10 text-outline border-outline/20',
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`
      inline-flex items-center gap-1.5
      rounded-full px-2.5 py-1
      text-[10px] font-mono uppercase tracking-wider
      border ${statusConfig[status]}
    `}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current`} />
      {label}
    </span>
  )
}
```

### KpiBlock.tsx

```tsx
interface KpiBlockProps {
  label: string
  value: string
  trend?: string
  trendUp?: boolean
}

export function KpiBlock({ label, value, trend, trendUp = true }: KpiBlockProps) {
  return (
    <div className="bg-surface-container-low p-5 rounded-xl border-b-2 border-transparent hover:border-primary/40 transition-all group">
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
        {label}
      </p>
      <h3 className="text-3xl font-mono font-bold text-on-surface group-hover:text-primary transition-colors">
        {value}
      </h3>
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-mono ${trendUp ? 'text-primary' : 'text-error'}`}>
          <span className="material-symbols-outlined text-sm">
            {trendUp ? 'trending_up' : 'trending_down'}
          </span>
          {trend}
        </div>
      )}
    </div>
  )
}
```

### EmptyState.tsx

```tsx
interface EmptyStateProps {
  icon: string
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4">
        {icon}
      </span>
      <h3 className="font-headline text-lg font-bold text-on-surface mb-2">{title}</h3>
      <p className="text-sm text-on-surface-variant max-w-xs">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 px-6 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded shadow-primary-sm hover:scale-95 transition-transform duration-150"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
```

### AlertCard.tsx

```tsx
type Severity = 'critical' | 'warning' | 'success'

interface AlertCardProps {
  severity: Severity
  title: string
  description: string
  time: string
  action?: { label: string; href: string }
}

const severityStyles: Record<Severity, { border: string; icon: string; iconColor: string }> = {
  critical: {
    border: 'border-error/50',
    icon: 'warning',
    iconColor: 'text-error',
  },
  warning: {
    border: 'border-tertiary-container/50',
    icon: 'error',
    iconColor: 'text-tertiary-container',
  },
  success: {
    border: 'border-primary/50',
    icon: 'verified',
    iconColor: 'text-primary',
  },
}

export function AlertCard({ severity, title, description, time, action }: AlertCardProps) {
  const styles = severityStyles[severity]
  return (
    <div className={`bg-surface-container p-6 rounded-xl border-l-4 ${styles.border}`}>
      <div className="flex justify-between items-start mb-4">
        <span
          className={`material-symbols-outlined ${styles.iconColor}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {styles.icon}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant">{time}</span>
      </div>
      <h5 className="font-bold text-on-surface text-lg">{title}</h5>
      <p className="text-sm text-on-surface-variant mt-1">{description}</p>
      {action && (
        <a
          href={action.href}
          className="mt-4 inline-block text-[11px] font-mono text-primary uppercase tracking-wider hover:underline"
        >
          {action.label}
        </a>
      )}
    </div>
  )
}
```

---

## Framer Motion Variants

```tsx
// lib/motion.ts
export const pageVariants = {
  initial:  { opacity: 0, y: 8 },
  animate:  { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:     { opacity: 0, y: -8, transition: { duration: 0.15, ease: 'easeIn' } },
}

export const cardVariants = {
  initial:  { opacity: 0, scale: 0.96 },
  animate:  { opacity: 1, scale: 1 },
  hover:    { y: -2, transition: { duration: 0.15 } },
}

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.05 }
  }
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
}

export const modalVariants = {
  initial:  { opacity: 0, scale: 0.95 },
  animate:  { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 30 } },
  exit:     { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
}

export const toastVariants = {
  initial:  { opacity: 0, x: 40 },
  animate:  { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 400, damping: 35 } },
  exit:     { opacity: 0, x: 40, transition: { duration: 0.15 } },
}
```

---

## Навигация — конфиг для RBAC

```tsx
// lib/navigation.ts
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'CLIENT'

export interface NavItem {
  label: string
  href: string
  icon: string
  roles: UserRole[]
  badge?: string
}

export const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'dashboard',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST'],
  },
  {
    label: 'Clients',
    href: '/clients',
    icon: 'business_center',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: 'description',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST'],
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: 'monitoring',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST'],
  },
  {
    label: 'Intelligence',
    href: '/intelligence',
    icon: 'hub',
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  },
  {
    label: 'Team',
    href: '/team',
    icon: 'group',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    label: 'My GRI',
    href: '/my/gri',
    icon: 'radar',
    roles: ['CLIENT'],
  },
  {
    label: 'My Reports',
    href: '/my/reports',
    icon: 'folder',
    roles: ['CLIENT'],
  },
]

// Фильтр по роли
export function getNavForRole(role: UserRole): NavItem[] {
  return navItems.filter(item => item.roles.includes(role))
}
```

---

*Этот файл — living document. Обновляй при изменении дизайна.*
