import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'

export const metadata = { title: 'Страница не найдена' }

// Branded 404 — Next.js ships a bare white default otherwise, which breaks the
// dark theme and shows English copy. This matches the portal (teal on dark, RU).
export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo href="/" />
        </div>
        <p className="font-headline text-7xl font-bold bg-gradient-to-br from-primary to-primary-container bg-clip-text text-transparent">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-on-surface">Страница не найдена</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Возможно, ссылка устарела или страница была перемещена.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link
            href="/dashboard"
            className="px-6 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-transform"
          >
            На дашборд
          </Link>
          <Link
            href="/"
            className="px-6 py-2.5 border border-outline-variant/40 text-on-surface-variant text-sm rounded-lg hover:bg-surface-container transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  )
}
