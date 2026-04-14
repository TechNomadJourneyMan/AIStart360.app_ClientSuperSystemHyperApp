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
    label: 'Application Received',
    sublabel: 'Your application is awaiting review by an administrator',
    icon: 'schedule',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    pulseColor: 'bg-amber-400/20',
  },
  requires_clarification: {
    label: 'Clarification Required',
    sublabel: 'The administrator has requested additional information. Check your email.',
    icon: 'info',
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    pulseColor: 'bg-orange-400/20',
  },
  approved: {
    label: 'Approved!',
    sublabel: 'Your application has been approved. Welcome to AIStart360!',
    icon: 'check_circle',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    pulseColor: 'bg-primary/20',
  },
  rejected: {
    label: 'Application Rejected',
    sublabel: 'Unfortunately, your application has been rejected. Contact us for details.',
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
          setTimeout(() => router.push('/client/dashboard'), 2000)
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
    { label: 'Application received', done: true },
    { label: 'Under review', done: status === 'approved' || status === 'requires_clarification' },
    { label: 'Decision made', done: status === 'approved' || status === 'rejected' },
  ]

  return (
    <div className="min-h-screen bg-[#0A0B0F] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
        <Image src="/logo.svg" alt="AIStart360" width={140} height={26} priority />
        <div className="flex items-center gap-3">
          {userEmail && (
            <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-3 py-1.5 rounded-lg">
              {userEmail}
            </span>
          )}
          <button onClick={() => { document.cookie = 'aistart360_role=; path=/; max-age=0'; window.location.href = '/login' }}
            className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1 border border-red-500/10 px-2.5 py-1.5 rounded-lg transition-all">
            <span className="material-symbols-outlined text-sm">logout</span>
            Sign Out
          </button>
        </div>
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
                <span className="text-xs text-on-surface-variant">Usually within <strong className="text-on-surface">24 hours</strong></span>
              </div>
            )}

            {/* Redirecting indicator */}
            {isRedirecting && (
              <div className="mt-5 flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-sm text-primary">Redirecting to your dashboard...</span>
              </div>
            )}
          </div>

          {/* Progress Steps */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
            <h2 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest mb-5">
              Application Status
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
          {status === 'approved' && (
            <div className="grid grid-cols-2 gap-3">
              <Link href="/client/onboarding" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">assignment</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Fill out survey in advance</span>
                <span className="text-[10px] text-on-surface-variant text-center">Speed up the review process</span>
              </Link>
              <Link href="/client/onboarding/documents" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">upload_file</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Upload Documents</span>
                <span className="text-[10px] text-on-surface-variant text-center">P&L, balance sheet, reports</span>
              </Link>
            </div>
          )}
          {status !== 'rejected' && status !== 'approved' && (
            <div className="grid grid-cols-3 gap-3">
              <Link href="/client/onboarding" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">assignment</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Fill Out Survey</span>
                <span className="text-[10px] text-on-surface-variant text-center">Speed up the review process</span>
              </Link>
              <Link href="/client/my-data" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">person_book</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">My Data</span>
                <span className="text-[10px] text-on-surface-variant text-center">View submitted data</span>
              </Link>
              <Link href="/client/onboarding/documents" className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.06] hover:border-primary/20 p-5 transition-all group">
                <span className="material-symbols-outlined text-2xl text-primary">upload_file</span>
                <span className="text-xs text-center text-on-surface group-hover:text-on-surface/90 font-medium leading-tight">Upload Documents</span>
                <span className="text-[10px] text-on-surface-variant text-center">P&L, balance sheet, reports</span>
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
              Contact Administrator
            </a>
            <p className="text-[10px] text-on-surface-variant/50 font-mono">
              Last check: {lastChecked.toLocaleTimeString('en-US', { timeZone: 'Asia/Almaty' })} · refreshes every 30 sec
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
