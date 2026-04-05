'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import type { ApprovalStatus } from '@/types/onboarding'

type StatusConfig = {
  label: string
  sublabel: string
  icon: string
  color: string
  bgColor: string
  pulseColor: string
}

const STATUS_CONFIG: Record<ApprovalStatus, StatusConfig> = {
  pending_approval: {
    label: 'Заявка получена',
    sublabel: 'Ваша заявка ожидает рассмотрения администратором',
    icon: 'schedule',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    pulseColor: 'bg-amber-400/20',
  },
  requires_clarification: {
    label: 'Требуется уточнение',
    sublabel: 'Администратор запросил дополнительную информацию. Проверьте email.',
    icon: 'info',
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    pulseColor: 'bg-orange-400/20',
  },
  approved: {
    label: 'Одобрено!',
    sublabel: 'Ваша заявка одобрена. Добро пожаловать в AIStart360!',
    icon: 'check_circle',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    pulseColor: 'bg-primary/20',
  },
  rejected: {
    label: 'Заявка отклонена',
    sublabel: 'К сожалению, ваша заявка была отклонена. Свяжитесь с нами для уточнения.',
    icon: 'cancel',
    color: 'text-error',
    bgColor: 'bg-error/10',
    pulseColor: 'bg-error/20',
  },
}

export default function WaitingRoomPage() {
  const router = useRouter()
  const [status, setStatus] = useState<ApprovalStatus>('pending_approval')
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')
  const [lastChecked, setLastChecked] = useState<Date>(new Date())
  const [isRedirecting, setIsRedirecting] = useState(false)

  // Get user from Supabase session only.
  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (u?.id) {
        setUserId(u.id)
        setUserEmail(u.email ?? '')
      }
    })
  }, [])

  const checkStatus = useCallback(async () => {
    if (!userId) return
    try {
      // Use server API to bypass RLS issues
      const res = await fetch(`/api/client/status?userId=${userId}`)
      const data = await res.json()

      if (data?.status) {
        setStatus(data.status as ApprovalStatus)
        setLastChecked(new Date())

        if (data.status === 'approved') {
          setIsRedirecting(true)
          setTimeout(() => router.push('/client/onboarding'), 2000)
        }
      }
    } catch {}
  }, [userId, router])

  useEffect(() => {
    if (!userId) return
    checkStatus()
    const interval = setInterval(checkStatus, 30_000)
    return () => clearInterval(interval)
  }, [userId, checkStatus])

  const cfg = STATUS_CONFIG[status]

  const steps = [
    { label: 'Заявка получена', done: true },
    { label: 'На проверке', done: status === 'approved' || status === 'requires_clarification' },
    { label: 'Решение принято', done: status === 'approved' || status === 'rejected' },
  ]

  return (
    <div className="min-h-screen bg-[#0A0B0F] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
        <Image src="/logo.svg" alt="AIStart360" width={140} height={26} priority />
        {userEmail && (
          <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-3 py-1.5 rounded-lg">
            {userEmail}
          </span>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">

          {/* Status Card */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-8 text-center relative overflow-hidden">
            {/* Background glow */}
            <div className={`absolute inset-0 opacity-[0.03] ${cfg.bgColor} blur-3xl`} />

            {/* Animated status icon */}
            <div className="relative inline-flex items-center justify-center mb-6">
              <div className={`absolute inset-0 rounded-full animate-ping ${cfg.pulseColor}`} />
              <div className={`relative w-20 h-20 rounded-full ${cfg.bgColor} flex items-center justify-center`}>
                <span className={`material-symbols-outlined text-4xl ${cfg.color}`}>{cfg.icon}</span>
              </div>
            </div>

            <h1 className={`font-headline text-2xl font-extrabold mb-2 ${cfg.color}`}>
              {cfg.label}
            </h1>
            <p className="text-sm text-on-surface-variant leading-relaxed max-w-sm mx-auto">
              {cfg.sublabel}
            </p>

            {/* Estimated time */}
            {status === 'pending_approval' && (
              <div className="mt-5 inline-flex items-center gap-2 bg-surface-container px-4 py-2 rounded-xl">
                <span className="material-symbols-outlined text-base text-on-surface-variant">timer</span>
                <span className="text-xs text-on-surface-variant">Обычно в течение <strong className="text-on-surface">24 часов</strong></span>
              </div>
            )}

            {/* Redirecting indicator */}
            {isRedirecting && (
              <div className="mt-5 flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-sm text-primary">Переходим в личный кабинет...</span>
              </div>
            )}
          </div>

          {/* Progress Steps */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
            <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-5">
              Статус заявки
            </h2>
            <div className="flex items-center gap-0">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      step.done
                        ? 'bg-primary/20 border border-primary/40'
                        : i === 0 ? 'bg-amber-400/20 border border-amber-400/40'
                        : 'bg-surface-container border border-white/[0.08]'
                    }`}>
                      {step.done ? (
                        <span className="material-symbols-outlined text-sm text-primary">check</span>
                      ) : i === 0 ? (
                        <span className="material-symbols-outlined text-sm text-amber-400">radio_button_checked</span>
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-on-surface-variant/30" />
                      )}
                    </div>
                    <p className={`text-[10px] font-mono mt-2 text-center max-w-[70px] leading-tight ${
                      step.done ? 'text-primary' : i === 0 ? 'text-amber-400' : 'text-on-surface-variant/40'
                    }`}>{step.label}</p>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-2 mb-6 transition-all ${step.done ? 'bg-primary/30' : 'bg-white/[0.06]'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* CTAs */}
          {status !== 'rejected' && (
            <div className="grid grid-cols-2 gap-3">
              <Link href="/client/onboarding" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">assignment</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Заполнить анкету заранее</span>
                <span className="text-[10px] text-on-surface-variant text-center">Ускорьте процесс проверки</span>
              </Link>
              <Link href="/client/onboarding/documents" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">upload_file</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Загрузить документы</span>
                <span className="text-[10px] text-on-surface-variant text-center">P&L, баланс, отчёты</span>
              </Link>
            </div>
          )}

          {/* Contact admin */}
          <div className="text-center space-y-3">
            <a
              href="mailto:admin@aistart360.kz"
              className="inline-flex items-center gap-2 text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-base">mail</span>
              Написать администратору
            </a>
            <p className="text-[10px] text-on-surface-variant/50 font-mono">
              Последняя проверка: {lastChecked.toLocaleTimeString('ru-RU')} · обновляется каждые 30 сек
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
