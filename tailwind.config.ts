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
        primary:                     '#6effc0',
        'primary-container':         '#00e5a0',
        'primary-fixed':             '#47ffb8',
        'primary-fixed-dim':         '#00e29e',
        'on-primary':                '#003824',
        'on-primary-container':      '#006141',
        'on-primary-fixed':          '#002114',
        'on-primary-fixed-variant':  '#005236',
        'inverse-primary':           '#006c49',
        'surface-tint':              '#00e29e',

        // Secondary (Lavender/Blue)
        secondary:                     '#bcc7de',
        'secondary-container':         '#3e495d',
        'secondary-fixed':             '#d8e3fb',
        'secondary-fixed-dim':         '#bcc7de',
        'on-secondary':                '#263143',
        'on-secondary-container':      '#aeb9d0',
        'on-secondary-fixed':          '#111c2d',
        'on-secondary-fixed-variant':  '#3c475a',

        // Tertiary (Amber/Warm)
        tertiary:                      '#ffe1bd',
        'tertiary-container':          '#ffbd60',
        'tertiary-fixed':              '#ffddb4',
        'tertiary-fixed-dim':          '#ffb955',
        'on-tertiary':                 '#452b00',
        'on-tertiary-container':       '#754b00',
        'on-tertiary-fixed':           '#291800',
        'on-tertiary-fixed-variant':   '#633f00',

        // Error (Red/Salmon)
        error:                  '#ffb4ab',
        'error-container':      '#93000a',
        'on-error':             '#690005',
        'on-error-container':   '#ffdad6',

        // Surfaces
        background:                   '#0A0B0F',
        surface:                      '#121317',
        'surface-dim':                '#121317',
        'surface-bright':             '#38393e',
        'surface-container-lowest':   '#0d0e12',
        'surface-container-low':      '#1a1b20',
        'surface-container':          '#1f1f24',
        'surface-container-high':     '#292a2e',
        'surface-container-highest':  '#343439',
        'surface-variant':            '#343439',

        // On colors / Text
        'on-surface':          '#e3e2e8',
        'on-surface-variant':  '#bacbbf',
        'on-background':       '#e3e2e8',
        'inverse-surface':     '#e3e2e8',
        'inverse-on-surface':  '#2f3035',

        // Outline
        outline:           '#84958a',
        'outline-variant':  '#3b4a41',
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
        'primary-sm': '0 2px 8px rgba(110, 255, 192, 0.08)',
        'primary-md': '0 4px 16px rgba(110, 255, 192, 0.12)',
        'card':       '0 2px 12px rgba(0, 0, 0, 0.4)',
        'modal':      '0 8px 40px rgba(0, 0, 0, 0.6)',
        'sidebar':    '4px 0 24px rgba(0, 0, 0, 0.3)',
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
