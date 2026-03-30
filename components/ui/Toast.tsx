'use client'

import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui.store'

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  return (
    <div
      className="fixed bottom-6 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

interface ToastItemProps {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  onClose: () => void
}

const toastConfig = {
  success: { icon: 'check_circle', color: 'text-primary', bg: 'border-primary/20' },
  error:   { icon: 'error', color: 'text-error', bg: 'border-error/20' },
  warning: { icon: 'warning', color: 'text-tertiary-container', bg: 'border-tertiary-container/20' },
  info:    { icon: 'info', color: 'text-secondary', bg: 'border-secondary/20' },
}

function ToastItem({ type, title, description, onClose }: ToastItemProps) {
  const cfg = toastConfig[type]

  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className={`
        pointer-events-auto flex items-start gap-3
        bg-surface-container-high border ${cfg.bg}
        rounded-xl px-4 py-3 shadow-modal
        min-w-[280px] max-w-sm
        animate-slide-in-right
      `}
      role="alert"
    >
      <span className={`material-symbols-outlined text-xl flex-shrink-0 mt-0.5 ${cfg.color}`}>
        {cfg.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface">{title}</p>
        {description && <p className="text-xs text-on-surface-variant mt-0.5">{description}</p>}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-on-surface-variant hover:text-on-surface transition-colors ml-1"
        aria-label="Закрыть"
      >
        <span className="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
  )
}
