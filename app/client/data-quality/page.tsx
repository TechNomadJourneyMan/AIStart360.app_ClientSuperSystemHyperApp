'use client'

/**
 * /client/data-quality — lists ai_conflicts for the current client's company.
 *
 * Owner-facing UI: resolves conflicts by picking one contender at a time.
 * RLS policy ai_conflicts_owner_read gates access.
 */

import { useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import { DataConflictModal, type ConflictRow } from '@/components/ai/DataConflictModal'

interface PendingConflict extends ConflictRow {
  created_at: string
}

export default function DataQualityPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<PendingConflict[]>([])
  const [selected, setSelected] = useState<PendingConflict | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createClient()
    void (async () => {
      const { data: user } = await sb.auth.getUser()
      if (!user?.user?.id) return

      const { data: company } = await sb
        .from('companies')
        .select('id')
        .eq('user_id', user.user.id)
        .maybeSingle()

      if (!company?.id) {
        setLoading(false)
        return
      }
      setCompanyId(company.id)

      const res = await fetch(
        `/api/v1/ai-conflicts?company_id=${company.id}&resolution=pending`
      )
      const json = await res.json()
      if (json?.data) setConflicts(json.data)
      setLoading(false)
    })()
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Качество данных</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Здесь собраны расхождения между источниками. Разрешите, какое значение использовать.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-on-surface-variant font-mono">Загрузка...</p>
      ) : !companyId ? (
        <p className="text-sm text-error font-mono">Компания не найдена.</p>
      ) : conflicts.length === 0 ? (
        <div className="rounded-xl border border-outline-variant p-8 text-center">
          <p className="text-sm text-on-surface-variant">
            Нет несогласованных данных. AI-сборщик и анкета совпадают.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {conflicts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className="
                w-full text-left p-4 rounded-xl border border-outline-variant
                hover:bg-surface-container transition-colors
              "
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm text-on-surface">
                  {c.entity_type.replace('metric.', '').replace(/_/g, ' ')}
                  {c.period_year && (
                    <span className="ml-2 text-on-surface-variant">
                      · {c.period_quarter ? `${c.period_quarter} ` : ''}{c.period_year}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-error bg-error/10 border border-error/20 rounded-full px-2 py-0.5">
                  {c.contenders.length} источника
                </span>
              </div>
              <p className="text-xs text-on-surface-variant font-mono">
                Значения: {c.contenders.map((v) => formatInline(v.value)).join(' | ')}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <DataConflictModal
          conflict={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
          onResolved={() => setConflicts((prev) => prev.filter((c) => c.id !== selected.id))}
        />
      )}
    </div>
  )
}

function formatInline(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString('ru-RU')
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '...' : v
  return String(v)
}
