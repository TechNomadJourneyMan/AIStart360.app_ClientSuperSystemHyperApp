'use client'

/**
 * Agent permission matrix: every platform permission with its code ceiling,
 * the effective decision the runtime applies, which agent tools need it and —
 * for agents.manage — a selector that writes an admin grant
 * (PUT /api/giga-admin/agents/:key/permissions). Choices looser than the
 * ceiling are locked: no grant can make an approval-gated action automatic.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Info, Lock, RotateCcw, ShieldAlert } from 'lucide-react'
import { Badge, Button, Panel, cx, gigaFetch } from '../kit'
import {
  CEILING_NOTE, DECISION, buildPermissionMatrix, explainOutcome, grantsPayload, isDecision,
  type CatalogEntry, type Decision, type GrantDraft,
} from './model'
import { NoRightHint, StatusChip } from './ui'

interface SaveResult { effective: Record<string, Decision>; capped: string[]; note: string | null }

export function PermissionMatrix({ agentKey, catalog, effective, tools, canManage, onSaved }: {
  agentKey: string
  catalog: readonly CatalogEntry[]
  effective: Record<string, string>
  tools: ReadonlyArray<{ name: string; permission: string }>
  canManage: boolean
  onSaved: (effective: Record<string, Decision>) => void
}) {
  const [draft, setDraft] = useState<GrantDraft>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ requested: Record<string, Decision | null>; res: SaveResult } | null>(null)
  const rows = useMemo(() => buildPermissionMatrix(catalog, effective, tools, draft), [catalog, effective, tools, draft])
  const dirtyCount = Object.keys(draft).length

  const setRow = (key: string, value: Decision | null) => {
    setResult(null)
    setDraft((d) => {
      const next = { ...d }
      if (value !== null && value === (isDecision(effective[key]) ? effective[key] : 'DENY') && !(key in d && d[key] === null)) delete next[key]
      else next[key] = value
      return next
    })
  }

  const save = async () => {
    const grants = grantsPayload(draft, catalog)
    if (!Object.keys(grants).length) return
    setSaving(true)
    setError(null)
    try {
      const res = await gigaFetch<SaveResult>(`/api/giga-admin/agents/${encodeURIComponent(agentKey)}/permissions`, { method: 'PUT', json: { grants } })
      setResult({ requested: grants, res })
      setDraft({})
      onSaved(res.effective)
      toast.success(res.capped.length ? 'Права сохранены, часть ограничена потолком' : 'Права агента сохранены')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить права')
    } finally {
      setSaving(false)
    }
  }

  const notes = result
    ? Object.entries(result.requested)
        .map(([k, req]) => {
          const entry = catalog.find((c) => c.key === k)
          const eff = result.res.effective[k]
          if (!entry || !isDecision(eff)) return null
          const text = explainOutcome(req, eff, entry.ceiling, result.res.capped.includes(k))
          return text ? { key: k, label: entry.label, text } : null
        })
        .filter((x): x is { key: string; label: string; text: string } => !!x)
    : []

  return (
    <Panel
      title="Права агента"
      description="Итог — самое строгое из трёх: потолок безопасности (задан в коде), выбор администратора и умолчание из определения агента. Право, которое агент не объявил, всегда запрещено."
      bodyClassName="p-0"
      actions={canManage ? (
        <>
          {dirtyCount > 0 && <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft({}); setError(null) }}>Отменить</Button>}
          <Button size="sm" variant="primary" disabled={!dirtyCount} loading={saving} onClick={() => void save()}>
            {dirtyCount ? `Сохранить (${dirtyCount})` : 'Сохранить'}
          </Button>
        </>
      ) : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[11px] text-slate-500">
        {(['ALLOW', 'REQUIRE_APPROVAL', 'DENY'] as const).map((d) => <StatusChip key={d} meta={DECISION[d]} />)}
        <span className="flex items-center gap-1"><Lock size={11} className="text-amber-300" /> — {CEILING_NOTE.toLowerCase()}</span>
      </div>

      {!canManage && <div className="border-b border-white/[0.06] px-4 py-2.5"><NoRightHint>Менять права может роль с правом «ИИ-агенты: управление».</NoRightHint></div>}

      {result?.res.note && (
        <p role="status" className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" /> {result.res.note}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="mx-4 mt-2 space-y-1">
          {notes.map((n) => (
            <li key={n.key} className="flex items-start gap-2 text-[11px] text-slate-400">
              <Info size={12} className="mt-0.5 shrink-0 text-blue-300" /> <span><b className="text-slate-200">{n.label}:</b> {n.text}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-2.5 font-medium">Право</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Потолок</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Сейчас действует</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{canManage ? 'Изменить' : 'Инструменты'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cx('border-b border-white/[0.04] align-top', r.dirty && 'bg-blue-500/[0.05]')}>
                <td className="px-4 py-2.5">
                  <p className="text-slate-200">{r.label}</p>
                  <p className="font-mono text-[10px] text-slate-600">{r.key}</p>
                  {r.ceilingLocked && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-300/90"><Lock size={10} /> {CEILING_NOTE}</p>
                  )}
                  {canManage && r.tools.length > 0 && (
                    <p className="mt-1 text-[10px] text-slate-500">Нужно инструментам: <span className="font-mono">{r.tools.join(', ')}</span></p>
                  )}
                </td>
                <td className="px-3 py-2.5"><StatusChip meta={DECISION[r.ceiling]} /></td>
                <td className="px-3 py-2.5">
                  <StatusChip meta={DECISION[r.effective]} />
                  {r.tools.length > 0 && <Badge tone="blue" className="ml-1.5">используется</Badge>}
                </td>
                <td className="px-3 py-2.5">
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={r.selected}
                        disabled={saving}
                        onChange={(e) => setRow(r.key, e.target.value as Decision)}
                        aria-label={`Решение для права «${r.label}»`}
                        className="w-44 rounded-xl border border-white/[0.08] bg-[#0b1128] px-2.5 py-1.5 text-[11px] text-slate-200 focus:border-blue-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      >
                        {r.options.map((o) => (
                          <option key={o.value} value={o.value} disabled={o.disabled}>
                            {o.label}{o.disabled ? ' — выше потолка' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setRow(r.key, null)}
                        title="Вернуть умолчание из определения агента"
                        aria-label={`Вернуть умолчание для права «${r.label}»`}
                        className={cx(
                          'inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                          r.reset ? 'bg-blue-500/15 text-blue-200' : 'text-slate-500 hover:text-slate-300',
                        )}
                      >
                        <RotateCcw size={11} /> по умолчанию
                      </button>
                      {r.dirty && <span className="text-[10px] text-blue-300">{r.reset ? 'будет сброшено' : 'изменено'}</span>}
                    </div>
                  ) : r.tools.length ? (
                    <span className="font-mono text-[10px] text-slate-400">{r.tools.join(', ')}</span>
                  ) : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-[10px] text-slate-600">
        «По умолчанию» удаляет выбор администратора, и действует значение из кода агента. Каждое изменение пишется в журнал аудита.
      </p>
    </Panel>
  )
}
