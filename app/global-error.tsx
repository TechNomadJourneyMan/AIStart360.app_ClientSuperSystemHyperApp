'use client'

// global-error replaces the root layout entirely, so it cannot rely on the
// app's global stylesheet or the Material Symbols font being present. Everything
// here is inline-styled and self-contained, in the portal's dark/teal palette.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ru">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          background: '#0A0B0F',
          color: '#e6f1ea',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
          <div
            style={{
              width: 64, height: 64, margin: '0 auto 1.5rem', borderRadius: '9999px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 32, fontWeight: 700,
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Критическая ошибка</h1>
          <p style={{ color: '#9aa5a0', margin: '0 0 1.5rem' }}>
            Произошла непредвиденная ошибка. Попробуйте обновить страницу.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#5f6b66', margin: '0 0 1rem', fontFamily: 'monospace' }}>
              ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem', border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
              background: 'linear-gradient(135deg,#6effc0,#00e5a0)', color: '#003824', fontWeight: 600,
            }}
          >
            Попробовать снова
          </button>
        </div>
      </body>
    </html>
  )
}
