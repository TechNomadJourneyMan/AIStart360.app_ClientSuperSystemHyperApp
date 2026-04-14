import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary (Brand Teal/Green)
        primary:                     'rgb(var(--color-primary) / <alpha-value>)',
        'primary-container':         'rgb(var(--color-primary-container) / <alpha-value>)',
        'primary-fixed':             'rgb(var(--color-primary-fixed) / <alpha-value>)',
        'primary-fixed-dim':         'rgb(var(--color-primary-fixed-dim) / <alpha-value>)',
        'on-primary':                'rgb(var(--color-on-primary) / <alpha-value>)',
        'on-primary-container':      'rgb(var(--color-on-primary-container) / <alpha-value>)',
        'on-primary-fixed':          'rgb(var(--color-on-primary-fixed) / <alpha-value>)',
        'on-primary-fixed-variant':  'rgb(var(--color-on-primary-fixed-variant) / <alpha-value>)',
        'inverse-primary':           'rgb(var(--color-inverse-primary) / <alpha-value>)',
        'surface-tint':              'rgb(var(--color-surface-tint) / <alpha-value>)',

        // Secondary (Lavender/Blue)
        secondary:                     'rgb(var(--color-secondary) / <alpha-value>)',
        'secondary-container':         'rgb(var(--color-secondary-container) / <alpha-value>)',
        'secondary-fixed':             'rgb(var(--color-secondary-fixed) / <alpha-value>)',
        'secondary-fixed-dim':         'rgb(var(--color-secondary-fixed-dim) / <alpha-value>)',
        'on-secondary':                'rgb(var(--color-on-secondary) / <alpha-value>)',
        'on-secondary-container':      'rgb(var(--color-on-secondary-container) / <alpha-value>)',
        'on-secondary-fixed':          'rgb(var(--color-on-secondary-fixed) / <alpha-value>)',
        'on-secondary-fixed-variant':  'rgb(var(--color-on-secondary-fixed-variant) / <alpha-value>)',

        // Tertiary (Amber/Warm)
        tertiary:                      'rgb(var(--color-tertiary) / <alpha-value>)',
        'tertiary-container':          'rgb(var(--color-tertiary-container) / <alpha-value>)',
        'tertiary-fixed':              'rgb(var(--color-tertiary-fixed) / <alpha-value>)',
        'tertiary-fixed-dim':          'rgb(var(--color-tertiary-fixed-dim) / <alpha-value>)',
        'on-tertiary':                 'rgb(var(--color-on-tertiary) / <alpha-value>)',
        'on-tertiary-container':       'rgb(var(--color-on-tertiary-container) / <alpha-value>)',
        'on-tertiary-fixed':           'rgb(var(--color-on-tertiary-fixed) / <alpha-value>)',
        'on-tertiary-fixed-variant':   'rgb(var(--color-on-tertiary-fixed-variant) / <alpha-value>)',

        // Error (Red/Salmon)
        error:                  'rgb(var(--color-error) / <alpha-value>)',
        'error-container':      'rgb(var(--color-error-container) / <alpha-value>)',
        'on-error':             'rgb(var(--color-on-error) / <alpha-value>)',
        'on-error-container':   'rgb(var(--color-on-error-container) / <alpha-value>)',

        // Surfaces
        background:                   'rgb(var(--color-background) / <alpha-value>)',
        surface:                      'rgb(var(--color-surface) / <alpha-value>)',
        'surface-dim':                'rgb(var(--color-surface-dim) / <alpha-value>)',
        'surface-bright':             'rgb(var(--color-surface-bright) / <alpha-value>)',
        'surface-container-lowest':   'rgb(var(--color-surface-container-lowest) / <alpha-value>)',
        'surface-container-low':      'rgb(var(--color-surface-container-low) / <alpha-value>)',
        'surface-container':          'rgb(var(--color-surface-container) / <alpha-value>)',
        'surface-container-high':     'rgb(var(--color-surface-container-high) / <alpha-value>)',
        'surface-container-highest':  'rgb(var(--color-surface-container-highest) / <alpha-value>)',
        'surface-variant':            'rgb(var(--color-surface-variant) / <alpha-value>)',

        // On colors / Text
        'on-surface':          'rgb(var(--color-on-surface) / <alpha-value>)',
        'on-surface-variant':  'rgb(var(--color-on-surface-variant) / <alpha-value>)',
        'on-background':       'rgb(var(--color-on-background) / <alpha-value>)',
        'inverse-surface':     'rgb(var(--color-inverse-surface) / <alpha-value>)',
        'inverse-on-surface':  'rgb(var(--color-inverse-on-surface) / <alpha-value>)',

        // Outline
        outline:           'rgb(var(--color-outline) / <alpha-value>)',
        'outline-variant':  'rgb(var(--color-outline-variant) / <alpha-value>)',
      },

      fontFamily: {
        headline: ['var(--font-headline)', 'Space Grotesk', 'sans-serif'],
        body:     ['var(--font-body)', 'Inter', 'sans-serif'],
        label:    ['var(--font-label)', 'DM Sans', 'sans-serif'],
        mono:     ['var(--font-mono)', 'monospace'],
      },

      borderRadius: {
        DEFAULT: '0.25rem',
        lg:      '0.5rem',
        xl:      '0.75rem',
        '2xl':   '1rem',
        '3xl':   '1.5rem',
        full:    '9999px',
      },

      boxShadow: {
        'primary-sm': 'var(--shadow-primary-sm, 0 2px 8px rgba(110, 255, 192, 0.08))',
        'primary-md': 'var(--shadow-primary-md, 0 4px 16px rgba(110, 255, 192, 0.12))',
        'card':       'var(--shadow-card, 0 2px 12px rgba(0, 0, 0, 0.4))',
        'modal':      'var(--shadow-modal, 0 8px 40px rgba(0, 0, 0, 0.6))',
        'sidebar':    'var(--shadow-sidebar, 4px 0 24px rgba(0, 0, 0, 0.3))',
      },

      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'radar-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.3' },
          '50%':      { transform: 'scale(1.05)', opacity: '0.5' },
        },
        'radar-rotate': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'bell-shake': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '20%':      { transform: 'rotate(10deg)' },
          '40%':      { transform: 'rotate(-10deg)' },
          '60%':      { transform: 'rotate(6deg)' },
          '80%':      { transform: 'rotate(-6deg)' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(40px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },

      animation: {
        shimmer:          'shimmer 1.5s infinite',
        'radar-pulse':    'radar-pulse 4s ease-in-out infinite',
        'radar-rotate':   'radar-rotate 60s linear infinite',
        'bell-shake':     'bell-shake 0.5s ease-in-out',
        'count-up':       'count-up 0.6s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
}

export default config
