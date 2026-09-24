'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, GigaApiError, Modal, Skeleton, gigaFetch, useGigaQuery } from '../../kit'
import type { ExpertTemplate } from './types'

/**
 * «Вставить шаблон»: шаблоны блока + универсальные («Общее»). Клик по
 * шаблону вставляет его текст в поле комментария.
 */
export function TemplatePicker({ open, onClose, block, blockLabel, onPick }: {
  open: boolean
  onClose: () => void
  block: string
  blockLabel: string
  onPick: (body: string) => void
}) {
  const { data, error, loading, reload } = useGigaQuery<{ data: ExpertTemplate[]; unavailable?: boolean }>(
    open ? `/api/giga-admin/expert-templates?block=${encodeURIComponent(block)}` : null,
  )
  const [removing, setRemoving] = useState<string | null>(null)
  const list = data?.data ?? []

  const remove = async (t: ExpertTemplate) => {
    setRemoving(t.id)
    try {
      await gigaFetch(`/api/giga-admin/expert-templates/${t.id}`, { method: 'DELETE' })
      toast.success('Шаблон удалён')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Шаблоны · ${blockLabel}`} wide>
      <ErrorState error={error} onRetry={reload} />
      {data?.unavailable && (
        <p className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
          Библиотека шаблонов недоступна — вероятно, не применена миграция 087.
        </p>
      )}
      {loading && !data && <Skeleton className="h-24" />}
      {data && !list.length && (
        <EmptyState title="Шаблонов пока нет" text="Сохраните удачную формулировку кнопкой «Сохранить как шаблон» под полем комментария." />
      )}
      <ul className="space-y-2">
        {list.map((t) => (
          <li key={t.id} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => { onPick(t.body); onClose() }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-xs font-semibold text-slate-200 hover:text-blue-200">{t.title}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-slate-400">{t.body}</p>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                {t.block === 'general' && block !== 'general' && <Badge>Общий</Badge>}
                {!t.is_shared && <Badge tone="violet">Личный</Badge>}
                {t.mine && (
                  <Button size="sm" variant="ghost" aria-label="Удалить шаблон" loading={removing === t.id} icon={<Trash2 size={12} />} onClick={() => void remove(t)} />
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
