'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SymbolIcon } from '@/components/ui/SymbolIcon'
import { INVITE_ONLY_LEAD } from '@/lib/registration/wait-text'

const INPUT_CLASS =
  'w-full h-12 text-base bg-surface-container-high/60 border border-outline rounded-xl pl-12 pr-4 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-colors placeholder:text-on-surface-variant'
const LABEL_CLASS = 'block text-sm font-medium text-on-surface-variant'
const ICON_CLASS =
  'absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors text-lg'

/**
 * «Регистрация по приглашению» + форма «Запросить приглашение» (Раунд 4, B3, N4B-3).
 *
 * Показывается вместо формы регистрации, когда registration_mode = 'invite'
 * (режим читает сервер страницы). Аккаунт не создаётся: POST
 * /api/auth/request-invite кладёт заявку в ГИГА и сообщает Admin / Super Admin.
 * Поле `website` — ловушка для ботов: скрыто от людей и от экранного диктора.
 *
 * `notice` — пометка сверху (например, вход через Google без приглашения).
 */
export function InviteRequestForm({ footer, notice }: { footer?: React.ReactNode; notice?: string | null }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [website, setWebsite] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const pending = useRef(false)

  // Пока обработчик не подключён, форма не отправляется сама (GET с данными в адресе).
  useEffect(() => { setHydrated(true) }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending.current || state !== 'idle') return
    setError(null)
    if (!consent) {
      setError('Нужно согласие на обработку данных — без него мы не сможем с вами связаться.')
      return
    }
    pending.current = true
    setState('sending')
    try {
      const res = await fetch('/api/auth/request-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email.trim(), company, contact, consent, website }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Не удалось отправить заявку. Попробуйте ещё раз.')
      setAnswer(data.message ?? null)
      setState('sent')
    } catch (err) {
      setState('idle')
      setError(err instanceof Error ? err.message : 'Не удалось отправить заявку. Попробуйте ещё раз.')
    } finally {
      pending.current = false
    }
  }

  const describedBy = error ? 'invite-request-error' : undefined

  return (
    <div data-invite-request>
      {/* The title («Регистрация по приглашению») is the page heading — AuthHome / /register. */}
      <p className="mb-4 text-base text-on-surface-variant leading-relaxed">{INVITE_ONLY_LEAD}</p>

      {notice && (
        <div role="status" data-invite-notice className="mb-4 p-4 bg-surface-container/60 border border-white/[0.08] rounded-xl flex items-start gap-3">
          <SymbolIcon name="info" className="text-primary text-lg mt-0.5" />
          <p className="text-base text-on-surface-variant flex-1">{notice}</p>
        </div>
      )}

      {state === 'sent' ? (
        <div role="status" data-invite-sent className="p-4 bg-primary/5 border border-primary/15 rounded-xl flex items-start gap-3">
          <SymbolIcon name="check_circle" className="text-primary text-lg mt-0.5" />
          <p className="text-base text-on-surface leading-relaxed">{answer}</p>
        </div>
      ) : (
        <>
          {error && (
            <div id="invite-request-error" role="alert" className="mb-4 p-4 bg-error/10 border border-error/20 rounded-xl flex items-start gap-3">
              <SymbolIcon name="error" className="text-error text-lg mt-1" />
              <p className="text-base text-error flex-1">{error}</p>
            </div>
          )}

          <form method="post" onSubmit={submit} aria-busy={state === 'sending'} aria-label="Запросить приглашение" className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="invite-name" className={LABEL_CLASS}>Ваше имя</label>
              <div className="relative group">
                <SymbolIcon name="person" className={ICON_CLASS} />
                <input id="invite-name" name="name" type="text" required minLength={2} maxLength={120} autoComplete="name"
                  disabled={!hydrated} value={name} onChange={(e) => setName(e.target.value)}
                  aria-describedby={describedBy} className={INPUT_CLASS} placeholder="Иван Иванов" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="invite-email" className={LABEL_CLASS}>Электронная почта</label>
              <div className="relative group">
                <SymbolIcon name="mail" className={ICON_CLASS} />
                <input id="invite-email" name="email" type="email" required maxLength={200} autoComplete="email"
                  autoCapitalize="none" spellCheck={false}
                  disabled={!hydrated} value={email} onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={describedBy} className={INPUT_CLASS} placeholder="info@company.kz" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="invite-company" className={LABEL_CLASS}>Название компании</label>
              <div className="relative group">
                <SymbolIcon name="business_center" className={ICON_CLASS} />
                <input id="invite-company" name="company" type="text" required minLength={2} maxLength={200} autoComplete="organization"
                  disabled={!hydrated} value={company} onChange={(e) => setCompany(e.target.value)}
                  aria-describedby={describedBy} className={INPUT_CLASS} placeholder="ТОО «Ромашка»" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="invite-contact" className={LABEL_CLASS}>
                Телефон или Telegram <span className="text-on-surface-variant/80">— по желанию</span>
              </label>
              <div className="relative group">
                <SymbolIcon name="call" className={ICON_CLASS} />
                <input id="invite-contact" name="contact" type="text" maxLength={120} autoComplete="tel"
                  disabled={!hydrated} value={contact} onChange={(e) => setContact(e.target.value)}
                  aria-describedby={describedBy} className={INPUT_CLASS} placeholder="+7 700 000 00 00 или @username" />
              </div>
            </div>

            {/* Ловушка для ботов: людям не видна, в порядок обхода не входит. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="invite-website">Сайт</label>
              <input id="invite-website" name="website" type="text" tabIndex={-1} autoComplete="off"
                value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input id="invite-consent" name="consent" type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)}
                disabled={!hydrated}
                className="mt-1 h-5 w-5 shrink-0 rounded border-outline bg-surface-container-high text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" />
              <label htmlFor="invite-consent" className="text-sm text-on-surface-variant leading-relaxed cursor-pointer">
                Даю согласие на обработку этих данных, чтобы команда AIStart360 связалась со мной, и принимаю{' '}
                <Link href="/privacy" className="text-primary underline hover:no-underline">Политику конфиденциальности</Link>
              </label>
            </div>

            <button type="submit" disabled={!hydrated || state === 'sending' || !consent} aria-busy={state === 'sending'}
              className="w-full min-h-12 px-4 py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2">
              {state === 'sending' ? (
                <><span aria-hidden="true" className="w-5 h-5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /><span role="status">Отправляем заявку…</span></>
              ) : (
                <>
                  <SymbolIcon name="mail" className="text-lg" />
                  Запросить приглашение
                </>
              )}
            </button>
          </form>
        </>
      )}

      {footer ?? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 mt-4 text-sm text-on-surface-variant">
          <span>Уже есть аккаунт или приглашение?</span>
          <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center text-primary font-bold hover:underline">Войти</Link>
        </div>
      )}
    </div>
  )
}
