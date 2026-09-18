'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  Check,
  Clock3,
  Copy,
  Link2,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { cn } from '@/lib/utils'
import type { JourneyConnectCodeResult } from './api'

type ConnectMode = 'share' | 'join'

interface DeviceConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canCreateCode: boolean
  persistenceLabel: string
  onCreateCode: () => Promise<JourneyConnectCodeResult>
  onRedeemCode: (code: string, deviceLabel: string) => Promise<void>
}

export function DeviceConnectDialog({
  open,
  onOpenChange,
  canCreateCode,
  persistenceLabel,
  onCreateCode,
  onRedeemCode,
}: DeviceConnectDialogProps) {
  const [mode, setMode] = useState<ConnectMode>(canCreateCode ? 'share' : 'join')
  const [issued, setIssued] = useState<JourneyConnectCodeResult | null>(null)
  const [code, setCode] = useState('')
  const [deviceLabel, setDeviceLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    setDeviceLabel((current) => current || defaultDeviceLabel())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [open])

  useEffect(() => {
    if (!open) {
      setError('')
      setCopied(false)
    }
  }, [open])

  const secondsLeft = issued
    ? Math.max(0, Math.ceil((Date.parse(issued.expiresAt) - now) / 1_000))
    : 0
  const expired = Boolean(issued && secondsLeft === 0)
  const formattedTime = useMemo(
    () => `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`,
    [secondsLeft],
  )

  const createCode = async () => {
    if (!canCreateCode || busy) return
    setBusy(true)
    setError('')
    setIssued(null)
    try {
      setIssued(await onCreateCode())
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось создать код. Проверьте серверное сохранение Journey.'))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!issued || expired) return
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setError('Не удалось скопировать автоматически. Выделите код и скопируйте вручную.')
    }
  }

  const redeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode || busy) return
    setBusy(true)
    setError('')
    try {
      await onRedeemCode(normalizedCode, deviceLabel.trim() || 'Новое устройство')
      onOpenChange(false)
      setCode('')
    } catch (cause) {
      setError(errorMessage(cause, 'Код не принят. Проверьте его и срок действия.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content
          aria-describedby="journey-device-connect-description"
          className="fixed inset-x-3 bottom-3 z-[71] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-3xl border border-white/10 bg-surface-container-lowest p-4 shadow-2xl outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(480px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
        >
          <div className="flex items-start gap-3 pr-9">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Smartphone className="size-5" aria-hidden />
            </div>
            <div>
              <Dialog.Title className="text-base font-semibold text-on-surface">
                Подключить устройство
              </Dialog.Title>
              <Dialog.Description id="journey-device-connect-description" className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                Войдите на втором устройстве в тот же аккаунт и используйте одноразовый код. После этого доска будет синхронизироваться через сервер.
              </Dialog.Description>
            </div>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Закрыть подключение устройства"
              className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-xl text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
            >
              <X className="size-4" aria-hidden />
            </button>
          </Dialog.Close>

          <p className="mt-4 rounded-xl bg-white/[0.035] px-3 py-2 text-[11px] leading-relaxed text-on-surface-variant">
            Сначала войдите в один и тот же аккаунт на обоих устройствах. Код связывает эту доску, но не заменяет вход в аккаунт.
          </p>

          <div className="mt-5 grid grid-cols-2 rounded-xl bg-white/[0.035] p-1" role="tablist" aria-label="Способ подключения">
            <ModeButton selected={mode === 'share'} onClick={() => { setMode('share'); setError('') }}>
              Показать код
            </ModeButton>
            <ModeButton selected={mode === 'join'} onClick={() => { setMode('join'); setError('') }}>
              Ввести код
            </ModeButton>
          </div>

          {mode === 'share' ? (
            <section className="mt-5" aria-label="Код для второго устройства">
              {!canCreateCode ? (
                <div className="rounded-2xl border border-tertiary-container/20 bg-tertiary-container/[0.06] p-4">
                  <p className="text-sm font-medium text-on-surface">Серверная синхронизация пока недоступна</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">
                    Сейчас: {persistenceLabel}. Код появится после подключения серверного сохранения — локальная доска не может синхронизироваться между устройствами.
                  </p>
                </div>
              ) : issued ? (
                <div className="text-center">
                  <p className="text-xs text-on-surface-variant">Введите этот код на втором устройстве</p>
                  <button
                    type="button"
                    disabled={expired}
                    onClick={copyCode}
                    aria-label={expired ? 'Код подключения истёк' : `Скопировать код подключения ${issued.code}`}
                    className="mx-auto mt-3 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.07] px-4 font-mono text-2xl font-semibold tracking-[0.16em] text-primary hover:bg-primary/10 disabled:border-white/10 disabled:bg-white/[0.025] disabled:text-on-surface-variant"
                  >
                    <span className="select-all">{issued.code}</span>
                    {copied ? <Check className="size-4 shrink-0" aria-hidden /> : <Copy className="size-4 shrink-0" aria-hidden />}
                  </button>
                  <p className={cn('mt-2 flex items-center justify-center gap-1.5 text-[11px]', expired ? 'text-error' : 'text-on-surface-variant')} aria-live="polite">
                    <Clock3 className="size-3" aria-hidden />
                    {expired ? 'Срок кода истёк' : `Действует ещё ${formattedTime}`}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={createCode}
                    className="mt-4 rounded-xl px-3 py-2 text-xs text-on-surface-variant hover:bg-white/5 hover:text-primary disabled:opacity-50"
                  >
                    Создать новый код
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-start gap-3 text-xs leading-relaxed text-on-surface-variant">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    Код действует недолго, используется один раз и безопасно связывает устройство с этой доской.
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={createCode}
                    className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-105 disabled:opacity-60"
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
                    {busy ? 'Создаём…' : 'Создать одноразовый код'}
                  </button>
                </div>
              )}
            </section>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={redeem}>
              <label className="block">
                <span className="text-xs font-medium text-on-surface">Код подключения</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 16))}
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  aria-label="Одноразовый код подключения"
                  className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-background px-4 text-center font-mono text-lg tracking-[0.14em] text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-on-surface">Название устройства</span>
                <input
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value.slice(0, 80))}
                  autoComplete="off"
                  placeholder="Например, телефон"
                  aria-label="Название подключаемого устройства"
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary/50"
                />
              </label>
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                После подтверждения текущая локальная доска сменится актуальной серверной версией связанного Journey.
              </p>
              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-105 disabled:opacity-50"
              >
                {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                {busy ? 'Подключаем…' : 'Подключить это устройство'}
              </button>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModeButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'min-h-9 rounded-lg px-2 text-xs font-medium',
        selected ? 'bg-surface-container-high text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface',
      )}
    >
      {children}
    </button>
  )
}

function defaultDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Новое устройство'
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Телефон' : 'Компьютер'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
