'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { CASE_PRIORITY, CASE_STATUS, CASE_TRIGGER } from '@/lib/admin/case-labels'
import { Badge, Button, EmptyState, ErrorState, GigaApiError, Panel, Select, Skeleton, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'

/**
 * Обращения клиента к эксперту (эскалации Smart Assistant).
 * Статус, приоритет и рекомендация эксперта меняются здесь; каждое изменение
 * пишется в журнал и уведомляет клиента.
 */

interface Issue { id?: string; severity?: string; message_ru?: string; message?: string }
interface Case {
  id: string; status: string; priority: string; trigger_type: string; title: string; summary: string | null
  detected_issues: Issue[] | null; user_message: string | null; assistant_recommendation: string | null
  expert_action_recommended: string | null; assigned_to: string | null; created_at: string; updated_at: string
}

const STATUS_OPTIONS = Object.entries(CASE_STATUS).map(([value, v]) => ({ value, label: v.label }))
const PRIORITY_OPTIONS = Object.entries(CASE_PRIORITY).map(([value, v]) => ({ value, label: v.label }))

function CaseCard({ c, userId, canReview, onChanged }: { c: Case; userId: string; canReview: boolean; onChanged: () => void }) {
  const [action, setAction] = useState(c.expert_action_recommended ?? '')
  const [busy, setBusy] = useState(false)

  const patch = async (json: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/cases`, { method: 'PATCH', json: { caseId: c.id, ...json } })
      toast.success(done)
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось обновить кейс')
    } finally {
      setBusy(false)
    }
  }

  const issues = (c.detected_issues ?? []).map((i) => i.message_ru || i.message).filter(Boolean) as string[]

  return (
    <Panel
      title={<span className="flex flex-wrap items-center gap-2">{c.title}<Badge tone={CASE_PRIORITY[c.priority]?.tone}>{CASE_PRIORITY[c.priority]?.label ?? c.priority}</Badge><Badge tone={CASE_STATUS[c.status]?.tone}>{CASE_STATUS[c.status]?.label ?? c.status}</Badge></span>}
      description={`${CASE_TRIGGER[c.trigger_type] ?? c.trigger_type} · создано ${fmtDateTime(c.created_at)}${c.updated_at !== c.created_at ? ` · изменено ${fmtDateTime(c.updated_at)}` : ''}`}
      actions={canReview ? (
        <>
          <Select label="Статус" value={c.status} options={STATUS_OPTIONS} onChange={(v) => void patch({ status: v }, 'Статус изменён')} />
          <Select label="Приоритет" value={c.priority} options={PRIORITY_OPTIONS} onChange={(v) => void patch({ priority: v }, 'Приоритет изменён')} />
        </>
      ) : undefined}
    >
      <div className="space-y-3 text-xs">
        {c.summary && <p className="text-slate-300">{c.summary}</p>}
        {c.user_message && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Сообщение клиента</p>
            <p className="whitespace-pre-wrap rounded-xl bg-white/[0.03] p-3 text-slate-300">{c.user_message}</p>
          </div>
        )}
        {!!issues.length && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Замечания ассистента ({issues.length})</p>
            <ul className="space-y-0.5 text-slate-400">{issues.slice(0, 10).map((m, i) => <li key={i}>• {m}</li>)}</ul>
          </div>
        )}
        {c.assistant_recommendation && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Рекомендация ассистента</p>
            <p className="whitespace-pre-wrap text-slate-300">{c.assistant_recommendation}</p>
          </div>
        )}
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Рекомендация эксперта</p>
          {canReview ? (
            <>
              <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3} maxLength={8000} className={inputClass} placeholder="Что вы советуете клиенту по этому обращению" />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="secondary" icon={<Save size={12} />} loading={busy} disabled={action.trim() === (c.expert_action_recommended ?? '').trim()}
                  onClick={() => void patch({ expert_action_recommended: action.trim() || null }, 'Рекомендация сохранена')}>
                  Сохранить
                </Button>
              </div>
            </>
          ) : (
            <p className="text-slate-400">{c.expert_action_recommended || '—'}</p>
          )}
        </div>
      </div>
    </Panel>
  )
}

export function CasesTab({ userId, canReview }: { userId: string; canReview: boolean }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: Case[]; unavailable?: boolean }>(`/api/giga-admin/users/${userId}/cases`)
  const cases = data?.data ?? []

  return (
    <div className="space-y-3">
      <ErrorState error={error} onRetry={reload} />
      {data?.unavailable && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">Хранилище кейсов недоступно.</p>
      )}
      {loading && !data && <Skeleton className="h-32" />}
      {data && !cases.length && (
        <Panel><EmptyState title="Обращений к эксперту нет" text="Здесь появятся эскалации Smart Assistant по этому клиенту." /></Panel>
      )}
      {cases.map((c) => <CaseCard key={`${c.id}:${c.updated_at}`} c={c} userId={userId} canReview={canReview} onChanged={reload} />)}
    </div>
  )
}
