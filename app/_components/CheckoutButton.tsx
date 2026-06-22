'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Variant = 'primary' | 'outline'

/**
 * Pricing CTA that starts a checkout. POSTs the chosen planKey to /api/checkout
 * and follows the returned checkoutUrl (a payment-gateway stub for paid plans,
 * or /dashboard for the free pilot). If the user isn't signed in the API returns
 * a loginUrl and we route there with a `?next` hint.
 */
export default function CheckoutButton({
  planKey,
  label,
  variant = 'primary',
  className = '',
}: {
  planKey: string
  label: string
  variant?: Variant
  className?: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string
        loginUrl?: string
        error?: string
      }

      if (res.status === 401) {
        // Not signed in — send to login, then bounce back to pricing.
        router.push(data.loginUrl ?? '/login?from=/%23pricing')
        return
      }
      if (!res.ok || !data.checkoutUrl) {
        setError(data.error ?? 'Не удалось оформить. Попробуйте позже.')
        setLoading(false)
        return
      }
      // Internal redirect (stub gateway or /dashboard).
      if (data.checkoutUrl.startsWith('/')) {
        router.push(data.checkoutUrl)
      } else {
        window.location.href = data.checkoutUrl
      }
    } catch {
      setError('Сеть недоступна. Проверьте подключение.')
      setLoading(false)
    }
  }

  const base =
    variant === 'primary'
      ? 'bg-primary text-on-primary hover:shadow-xl hover:shadow-primary/30'
      : 'border border-white/[0.08] text-on-surface hover:border-primary/40 hover:text-primary'

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={loading}
        aria-busy={loading}
        className={`w-full text-center font-semibold px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 disabled:cursor-wait ${base} ${className}`}
      >
        {loading ? (
          <>
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
            Оформляем…
          </>
        ) : (
          label
        )}
      </button>
      {error && (
        <p className="mt-2 text-xs text-error text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
