'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Pencil, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { JourneyFactView } from './model'

interface FactReviewProps {
  facts: JourneyFactView[]
  onConfirm: (id: string) => void
  onConfirmAll: () => void
  onEdit: (id: string, value: string) => void
  onReject: (id: string) => void
  onRestore: (id: string) => void
  className?: string
}

export function FactReview({
  facts,
  onConfirm,
  onConfirmAll,
  onEdit,
  onReject,
  onRestore,
  className,
}: FactReviewProps) {
  const reduceMotion = useReducedMotion()
  const pending = facts.filter((fact) => fact.status === 'pending')
  const rejected = facts.filter((fact) => fact.status === 'rejected')

  if (!pending.length && !rejected.length) return null

  return (
    <section
      aria-labelledby="fact-review-title"
      className={cn('rounded-2xl border border-white/10 bg-surface-container-lowest p-3 shadow-card', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <h2 id="fact-review-title" className="text-sm font-semibold text-on-surface">
              Проверьте извлечённые факты
            </h2>
          </div>
          <p className="mt-1 text-xs text-pretty text-on-surface-variant">
            В Точку A попадут только подтверждённые вами данные.
          </p>
        </div>
        {pending.length > 1 && (
          <button
            type="button"
            onClick={onConfirmAll}
            className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:bg-primary-container"
          >
            Подтвердить всё
          </button>
        )}
      </div>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {pending.map((fact) => (
            <motion.div
              key={fact.id}
              data-testid="pending-fact"
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            >
              <FactRow fact={fact} onConfirm={onConfirm} onEdit={onEdit} onReject={onReject} />
            </motion.div>
          ))}
        </AnimatePresence>

        {rejected.map((fact) => (
          <div key={fact.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-3 py-2 opacity-70">
            <div className="min-w-0">
              <p className="truncate text-xs text-on-surface-variant line-through">{fact.label}: {fact.value}</p>
              <p className="text-[10px] text-on-surface-variant">Отклонено</p>
            </div>
            <button
              type="button"
              aria-label={`Вернуть факт: ${fact.label}`}
              onClick={() => onRestore(fact.id)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function FactRow({
  fact,
  onConfirm,
  onEdit,
  onReject,
}: {
  fact: JourneyFactView
  onConfirm: (id: string) => void
  onEdit: (id: string, value: string) => void
  onReject: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(fact.value)

  const save = () => {
    const next = value.trim()
    if (!next) return
    onEdit(fact.id, next)
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-white/5 bg-surface-container p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[11px] text-on-surface-variant">{fact.label}</p>
            <span className="text-[10px] text-on-surface-variant/70">из: {fact.sourceLabel}</span>
          </div>
          {editing ? (
            <div className="mt-1.5 flex gap-2">
              <input
                aria-label={`Новое значение факта: ${fact.label}`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save()
                  if (event.key === 'Escape') setEditing(false)
                }}
                className="min-w-0 flex-1 rounded-lg border-white/10 bg-surface-container-low px-2.5 py-1.5 text-sm text-on-surface focus:border-primary focus:ring-primary/20"
              />
              <button type="button" onClick={save} className="rounded-lg bg-primary px-2.5 text-xs font-semibold text-on-primary">
                Сохранить
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-pretty font-medium text-on-surface">{fact.value}</p>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Подтвердить факт: ${fact.label}`}
              title="Подтвердить"
              onClick={() => onConfirm(fact.id)}
              className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
            >
              <Check className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Изменить факт: ${fact.label}`}
              title="Изменить"
              onClick={() => setEditing(true)}
              className="flex size-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Отклонить факт: ${fact.label}`}
              title="Отклонить"
              onClick={() => onReject(fact.id)}
              className="flex size-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
