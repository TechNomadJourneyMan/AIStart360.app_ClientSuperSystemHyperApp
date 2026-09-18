'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { History, Pencil, Trash2 } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, GigaApiError, JsonValue, Modal, Pagination, Panel, Skeleton,
  fmtDateTime, gigaFetch, inputClass, useGigaQuery, type Column,
} from '../kit'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { STEPS } from '@/components/onboarding/constants/step-config'

interface Section {
  id: string; title: string; description: string; steps: number[]; filled: number; total: number
  answers: Array<{ key: string; label: string; value: string; step: number }>
}
interface HistoryRow {
  id: number; question_key: string; operation: string; old_value: unknown; new_value: unknown
  changed_by: string | null; actor_label: string | null; source: string; impersonation_session_id: string | null; created_at: string; updated_at: string
  revisions?: number
}
interface SurveyPayload {
  data: {
    raw: Record<string, unknown>; answeredAt: Record<string, string>; sections: Section[]; percent: number
    history: HistoryRow[]; historyTotal: number; historyPage: number; historyPageSize: number
  }
}

/** Editable text for a stored value: strings stay strings, everything else is JSON. */
type EditKind = 'text' | 'number' | 'boolean' | 'json'
function toEditable(v: unknown): { text: string; kind: EditKind } {
  if (typeof v === 'string' || v === undefined || v === null) return { text: typeof v === 'string' ? v : '', kind: 'text' }
  if (typeof v === 'number') return { text: String(v), kind: 'number' }
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false', kind: 'boolean' }
  return { text: JSON.stringify(v, null, 2), kind: 'json' }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const HISTORY_SOURCE: Record<string, { label: string; tone: 'neutral' | 'violet' | 'amber' | 'blue' }> = {
  user: { label: 'пользователь', tone: 'neutral' },
  admin: { label: 'админ', tone: 'violet' },
  impersonation: { label: 'админ в кабинете', tone: 'amber' },
  service: { label: 'система', tone: 'blue' },
}

export function SurveyTab({ userId, canEdit, onChanged }: { userId: string; canEdit: boolean; onChanged?: () => void }) {
  const [historyPage, setHistoryPage] = useState(1)
  const [historyKey, setHistoryKey] = useState<string | null>(null)
  const url = `/api/giga-admin/users/${userId}/survey?historyPage=${historyPage}${historyKey ? `&key=${historyKey}` : ''}`
  const { data, error, loading, reload } = useGigaQuery<SurveyPayload>(url)
  const [edit, setEdit] = useState<{ key: string; label: string; text: string; kind: EditKind } | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ key: string; label: string } | null>(null)
  const d = data?.data

  const save = async (key: string, value: unknown) => {
    setSaving(true)
    try {
      const res = await gigaFetch<{ data: { updated: number; deleted: number } }>(`/api/giga-admin/users/${userId}/survey`, {
        method: 'PATCH',
        json: { changes: { [key]: value }, reason: reason || undefined },
      })
      toast.success(res.data.updated || res.data.deleted ? 'Анкета обновлена, изменение записано в историю' : 'Значение не изменилось')
      setEdit(null)
      setConfirmDelete(null)
      setReason('')
      void reload()
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const submitEdit = () => {
    if (!edit) return
    let value: unknown = edit.text
    if (edit.kind === 'json') {
      try { value = JSON.parse(edit.text) } catch { toast.error('Некорректный JSON'); return }
    } else if (edit.kind === 'number') {
      const n = Number(edit.text.replace(/\s/g, '').replace(',', '.'))
      if (!edit.text.trim() || !Number.isFinite(n)) { toast.error('Введите число'); return }
      value = n
    } else if (edit.kind === 'boolean') {
      value = edit.text === 'true'
    }
    void save(edit.key, value)
  }

  const historyColumns: Column<HistoryRow>[] = useMemo(() => [
    { key: 'at', header: 'Когда', render: (h) => <span className="whitespace-nowrap text-slate-400">{fmtDateTime(h.updated_at)}</span> },
    { key: 'field', header: 'Поле', render: (h) => <button type="button" className="text-left text-slate-200 hover:text-blue-300" onClick={() => { setHistoryKey(h.question_key); setHistoryPage(1) }}>{SURVEY_LABELS[h.question_key] ?? h.question_key}</button> },
    { key: 'who', header: 'Кто', render: (h) => (
      <div className="flex flex-col items-start gap-1">
        <Badge tone={HISTORY_SOURCE[h.source]?.tone ?? 'neutral'}>{HISTORY_SOURCE[h.source]?.label ?? h.source}</Badge>
        {h.actor_label && <span className="max-w-[10rem] truncate text-[10px] text-slate-500" title={h.actor_label}>{h.actor_label}</span>}
      </div>
    ) },
    { key: 'old', header: 'Было', className: 'max-w-[16rem]', render: (h) => <div className="max-h-24 overflow-hidden text-red-200/80"><JsonValue value={h.operation === 'INSERT' ? null : h.old_value} /></div> },
    { key: 'new', header: 'Стало', className: 'max-w-[16rem]', render: (h) => (
      <div className="max-h-28 overflow-hidden text-emerald-200/90">
        {h.operation === 'DELETE' ? <Badge tone="red">удалено</Badge> : <JsonValue value={h.new_value} />}
        {(h.revisions ?? 1) > 1 && (
          <p className="mt-1 text-[10px] text-slate-500">
            {h.revisions} {plural(h.revisions ?? 0, 'правка', 'правки', 'правок')} подряд{JSON.stringify(h.old_value) === JSON.stringify(h.new_value) ? ' · в итоге значение не изменилось' : ''} · подробно — в журнале аудита
          </p>
        )}
      </div>
    ) },
  ], [])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!d) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      {d.sections.every((s) => s.answers.length === 0) && (
        <Panel><EmptyState title="Анкета не заполнена" text="Ответов пока нет. Их можно внести здесь или в кабинете пользователя." /></Panel>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {d.sections.map((s) => (
          <Panel key={s.id} title={s.title} description={`${s.description} · заполнено ${s.filled} из ${s.total}`}>
            {s.answers.length === 0 ? (
              <p className="text-xs text-slate-600">Нет ответов</p>
            ) : (
              <dl className="divide-y divide-white/[0.04]">
                {s.answers.map((a) => (
                  <div key={a.key} className="group grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:gap-3">
                    <dt className="text-[11px] text-slate-500">
                      {a.label}
                      {d.answeredAt[a.key] && <span className="block text-[10px] text-slate-700">{fmtDateTime(d.answeredAt[a.key])}</span>}
                    </dt>
                    <dd className="whitespace-pre-line break-words text-xs text-slate-200">{a.value}</dd>
                    <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button size="sm" variant="ghost" aria-label="История поля" icon={<History size={12} />} onClick={() => { setHistoryKey(a.key); setHistoryPage(1) }} />
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" aria-label="Изменить" icon={<Pencil size={12} />} onClick={() => setEdit({ key: a.key, label: a.label, ...toEditable(d.raw[a.key]) })} />
                          <Button size="sm" variant="ghost" aria-label="Удалить ответ" icon={<Trash2 size={12} />} onClick={() => setConfirmDelete({ key: a.key, label: a.label })} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
        ))}
      </div>

      {canEdit && <AddAnswer onAdd={(key, label) => setEdit({ key, label, text: '', kind: 'text' })} existing={d.raw} />}

      <Panel
        title="История изменений"
        description={historyKey ? `Поле: ${SURVEY_LABELS[historyKey] ?? historyKey}` : 'Все изменения анкеты: кто, когда, было → стало'}
        actions={historyKey ? <Button size="sm" variant="ghost" onClick={() => { setHistoryKey(null); setHistoryPage(1) }}>Показать все поля</Button> : undefined}
        bodyClassName="p-0"
      >
        <DataTable
          columns={historyColumns}
          rows={d.history}
          rowKey={(h) => String(h.id)}
          loading={loading}
          empty={<EmptyState title="Изменений ещё нет" text="История ведётся с момента подключения GIGA-CRM." />}
        />
        <Pagination page={d.historyPage} pageSize={d.historyPageSize} total={d.historyTotal} onChange={setHistoryPage} />
      </Panel>

      <Modal
        open={!!edit}
        onClose={() => (saving ? undefined : setEdit(null))}
        title={edit ? `Изменить: ${edit.label}` : ''}
        wide
        footer={<><Button variant="ghost" onClick={() => setEdit(null)} disabled={saving}>Отмена</Button><Button variant="primary" onClick={submitEdit} loading={saving}>Сохранить</Button></>}
      >
        {edit && (
          <div className="space-y-3">
            <Field label={edit.kind === 'json' ? 'Значение (таблица / список, JSON)' : edit.kind === 'number' ? 'Число' : 'Значение'} hint={<span className="font-mono">{edit.key}</span>}>
              {edit.kind === 'boolean' ? (
                <select value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className={inputClass}>
                  <option value="true">Да</option>
                  <option value="false">Нет</option>
                </select>
              ) : edit.kind === 'number' ? (
                <input inputMode="decimal" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className={inputClass} />
              ) : (
                <textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={edit.kind === 'json' ? 12 : 4} className={`${inputClass} ${edit.kind === 'json' ? 'font-mono text-xs' : ''}`} />
              )}
            </Field>
            <Field label="Причина изменения (попадёт в журнал)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Удалить ответ?"
        text={confirmDelete ? `Ответ «${confirmDelete.label}» будет удалён. Старое значение сохранится в истории и журнале аудита.` : ''}
        confirmLabel="Удалить ответ"
        requireText="УДАЛИТЬ"
        loading={saving}
        onConfirm={() => confirmDelete && save(confirmDelete.key, null)}
      >
        <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
    </div>
  )
}

function AddAnswer({ onAdd, existing }: { onAdd: (key: string, label: string) => void; existing: Record<string, unknown> }) {
  const [key, setKey] = useState('')
  const groups = STEPS.map((st) => ({
    step: st.n,
    title: st.title,
    options: Object.entries(SURVEY_KEY_STEP)
      .filter(([k, n]) => n === st.n && (existing[k] === undefined || existing[k] === null || existing[k] === ''))
      .map(([k]) => [k, SURVEY_LABELS[k] ?? k] as const),
  })).filter((g) => g.options.length)
  if (!groups.length) return null
  const total = groups.reduce((n, g) => n + g.options.length, 0)
  return (
    <Panel title="Добавить данные в анкету" description={`Незаполненных полей: ${total}. Выберите поле и внесите значение.`}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Поле анкеты" className="min-w-[260px] flex-1 rounded-xl border border-white/[0.08] bg-[#0b1128] px-3 py-2 text-xs text-slate-200">
          <option value="">Выберите поле…</option>
          {groups.map((g) => (
            <optgroup key={g.step} label={`${g.step}. ${g.title}`}>
              {g.options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </optgroup>
          ))}
        </select>
        <Button variant="primary" disabled={!key} onClick={() => { onAdd(key, SURVEY_LABELS[key] ?? key); setKey('') }}>Заполнить</Button>
      </div>
    </Panel>
  )
}
