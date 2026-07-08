'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useAddClient } from '@/hooks/useCrm'

/**
 * Parse a pasted "Имя +7 777…" string into { name, phone }.
 * Grabs the first phone-like run of digits; the rest becomes the name.
 */
export function parsePastedContact(text: string): { name: string; phone: string } {
  const m = text.match(/(\+?\d[\d\s()\-]{7,}\d)/)
  const phone = m ? m[1].trim() : ''
  const name = (m ? text.replace(m[1], ' ') : text)
    .replace(/[,;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { name, phone }
}

export function AddClientInline({ onAdded }: { onAdded?: () => void }) {
  const add = useAddClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Введите имя клиента')
      return
    }
    add.mutate(
      { name: trimmed, phone: phone.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Клиент «${trimmed}» добавлен`)
          setName('')
          setPhone('')
          onAdded?.()
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Не удалось добавить клиента'
          toast.error(msg)
        },
      },
    )
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Буфер обмена пуст')
        return
      }
      const parsed = parsePastedContact(text)
      if (parsed.name) setName(parsed.name)
      if (parsed.phone) setPhone(parsed.phone)
      if (!parsed.name && !parsed.phone) {
        toast.error('Не удалось распознать имя и телефон')
      } else {
        toast.success('Данные вставлены — проверьте и сохраните')
      }
    } catch {
      toast.error('Нет доступа к буферу обмена')
    }
  }

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Добавить клиента</p>
        <button
          onClick={pasteFromClipboard}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary/80 hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-sm">content_paste</span>
          Вставить из буфера
        </button>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="Имя клиента *"
          className="flex-1 bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="+7 777 000 00 00"
          inputMode="tel"
          className="flex-1 sm:max-w-[220px] bg-surface-container border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 font-mono"
        />
        <button
          onClick={submit}
          disabled={add.isPending || !name.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span className={`material-symbols-outlined text-sm ${add.isPending ? 'animate-spin' : ''}`}>
            {add.isPending ? 'progress_activity' : 'person_add'}
          </span>
          Добавить
        </button>
      </div>
    </div>
  )
}
