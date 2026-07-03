'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/ui/Logo'

function ChallengeContent() {
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get('from') || '/dashboard'

  const [useBackup, setUseBackup] = useState(false)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [factors, setFactors] = useState<{ totp: boolean; webauthn: boolean } | null>(null)
  const [pkBusy, setPkBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    fetch('/api/v1/security/2fa/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (mounted && j.ok) setFactors({ totp: !!j.enabled, webauthn: !!j.webauthn_enabled }) })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  const usePasskey = async () => {
    if (pkBusy) return
    setPkBusy(true); setError(null)
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const optRes = await fetch('/api/v1/security/webauthn/authenticate/options', { method: 'POST', credentials: 'include' })
      const optJson = await optRes.json().catch(() => ({}))
      if (!optRes.ok || !optJson.ok) { setError('Не удалось начать проверку ключа.'); return }
      let asseResp
      try {
        asseResp = await startAuthentication(optJson.options)
      } catch (e) {
        setError((e as { name?: string })?.name === 'NotAllowedError'
          ? 'Проверка отменена. Можно ввести резервный код ниже.'
          : 'Ключ недоступен на этом устройстве.')
        return
      }
      const verRes = await fetch('/api/v1/security/webauthn/authenticate/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ response: asseResp }),
      })
      const verJson = await verRes.json().catch(() => ({}))
      if (!verRes.ok || !verJson.ok) { setError('Не удалось подтвердить ключ.'); return }
      router.replace(from)
    } catch {
      setError('Ошибка сети.')
    } finally {
      setPkBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/security/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(
          json.error === 'invalid_code' ? 'Неверный код. Попробуйте ещё раз.'
          : res.status === 429 ? 'Слишком много попыток. Подождите немного.'
          : 'Не удалось подтвердить код.',
        )
        return
      }
      router.replace(from)
    } catch {
      setError('Ошибка сети.')
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await createClient().auth.signOut()
    } catch {
      /* ignore */
    }
    window.location.href = '/login'
  }

  // Passkey-only users (no TOTP) always enter a backup code in the text field.
  const isBackup = (!!factors && !factors.totp) || useBackup

  return (
    <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-8 mb-6" />
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-2xl text-primary">verified_user</span>
          </div>
          <h1 className="text-xl font-headline font-extrabold text-on-surface">Подтверждение входа</h1>
          <p className="text-sm text-on-surface-variant/60 mt-1">
            {isBackup
              ? 'Введите один из ваших резервных кодов'
              : 'Введите 6-значный код из приложения-аутентификатора'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-xl flex items-start gap-2">
            <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
            <p className="text-[13px] text-error font-medium flex-1">{error}</p>
          </div>
        )}

        {factors?.webauthn && (
          <>
            <button
              type="button"
              onClick={usePasskey}
              disabled={pkBusy}
              className="w-full h-12 mb-4 bg-surface-container-high/60 border border-primary/20 rounded-xl flex items-center justify-center gap-2 text-on-surface hover:bg-surface-container-high transition-all disabled:opacity-50"
            >
              {pkBusy ? (
                <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg text-primary">fingerprint</span>
                  Войти по Face ID / Touch ID / ключом
                </>
              )}
            </button>
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] font-mono text-on-surface-variant/40 bg-[#0a0e17] uppercase tracking-widest">или код</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus={!factors?.webauthn}
            inputMode={isBackup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(isBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={isBackup ? 'XXXXX-XXXXX' : '000000'}
            aria-label="Код подтверждения"
            className="w-full h-14 bg-surface-container-high/60 border border-white/[0.08] rounded-xl px-4 text-center text-2xl font-mono tracking-[0.3em] text-on-surface focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
          />
          <button
            type="submit"
            disabled={loading || code.trim().length < 6}
            className="w-full h-12 bg-gradient-to-r from-primary to-emerald-400 text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[0.99] active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
            ) : (
              'Подтвердить'
            )}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs">
          {factors?.totp ? (
            <button
              type="button"
              onClick={() => { setUseBackup((v) => !v); setCode(''); setError(null) }}
              className="text-primary/70 hover:text-primary transition-colors"
            >
              {useBackup ? 'Ввести код из приложения' : 'Использовать резервный код'}
            </button>
          ) : <span />}
          <button type="button" onClick={logout} className="text-on-surface-variant/50 hover:text-on-surface-variant transition-colors">
            Выйти
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TwoFactorChallengePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0e17]" />}>
      <ChallengeContent />
    </Suspense>
  )
}
