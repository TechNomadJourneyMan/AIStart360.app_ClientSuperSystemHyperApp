'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowUpRight, ExternalLink, Trash2 } from 'lucide-react'
import { Badge, Button, ConfirmDialog, Drawer, Field, GigaApiError, gigaFetch, inputClass } from '../kit'
import { SurveyTab } from '../user360/SurveyTab'
import { ImpersonateDialog } from '../user360/ImpersonateDialog'
import { useStaff } from '../StaffContext'
import { invalidateSurveyPreview, type SurveyPreview } from './SurveyPreviewCard'

/**
 * One user's questionnaire in a side panel: all answers by theme, edit /
 * delete / add answers, change history, delete the whole survey, open the
 * survey in the user's cabinet (admin mode), jump to User 360.
 */
export function SurveyDrawer({ user, onClose, onChanged }: {
  user: Pick<SurveyPreview, 'id' | 'name' | 'email' | 'company'> & { role?: string; staffRole?: string | null } | null
  onClose: () => void
  onChanged: () => void
}) {
  const { can } = useStaff()
  const [openCabinet, setOpenCabinet] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  // Opened by a direct link (?user=…) the row may be on another page: fetch who it is.
  const [info, setInfo] = useState<SurveyPreview | null>(null)
  useEffect(() => {
    if (!user || user.company || user.name || user.email) return
    let alive = true
    gigaFetch<{ data: SurveyPreview }>(`/api/giga-admin/surveys/${user.id}/preview`).then((r) => { if (alive) setInfo(r.data) }).catch(() => {})
    return () => { alive = false }
  }, [user])
  if (!user) return null
  const name = user.name ?? info?.name ?? null
  const email = user.email ?? info?.email ?? null
  const title = user.company || info?.company || name || email || 'Пользователь'
  const role = user.role ?? info?.role
  const isStaffAccount = !!user.staffRole || role === 'super_admin' || role === 'admin'

  const wipe = async () => {
    setBusy(true)
    try {
      const r = await gigaFetch<{ data: { deleted: number } }>(`/api/giga-admin/users/${user.id}/survey`, { method: 'DELETE', json: { reason, confirm: 'УДАЛИТЬ' } })
      toast.success(`Анкета удалена (ответов: ${r.data.deleted}). Копия — в журнале аудита.`)
      setConfirmWipe(false)
      setReason('')
      invalidateSurveyPreview(user.id)
      setVersion((v) => v + 1)
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить анкету')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={<span className="flex items-center gap-2">Анкета · {title}</span>}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{[name, email].filter(Boolean).join(' · ')}</span>
        <Link href={`/admin-giga-panel/users/${user.id}`} className="inline-flex items-center gap-1 rounded-xl border border-white/[0.1] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.06]">
          <ArrowUpRight size={13} /> User 360
        </Link>
        {can('impersonate.view') && !isStaffAccount && (
          <Button variant="warning" icon={<ExternalLink size={13} />} onClick={() => setOpenCabinet(true)}>Открыть анкету в кабинете</Button>
        )}
        {can('survey.delete') && (
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirmWipe(true)}>Удалить всю анкету</Button>
        )}
        {!can('survey.edit') && <Badge>только просмотр</Badge>}
      </div>

      <SurveyTab key={version} userId={user.id} canEdit={can('survey.edit')} onChanged={() => { invalidateSurveyPreview(user.id); onChanged() }} />

      <ImpersonateDialog
        open={openCabinet}
        onClose={() => setOpenCabinet(false)}
        userId={user.id}
        userLabel={title}
        allowEdit={can('impersonate.edit')}
        redirect="/client/onboarding"
        defaultMode={can('impersonate.edit') ? 'edit' : 'view'}
        defaultReason="Работа с анкетой пользователя"
      />
      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Удалить всю анкету пользователя?"
        text="Будут удалены все ответы анкеты. Прогресс, Точка А и профиль бизнеса пересчитаются по пустой анкете. Полная копия ответов сохранится в журнале аудита и истории изменений."
        confirmLabel="Удалить анкету"
        requireText="УДАЛИТЬ"
        loading={busy}
        onConfirm={wipe}
      >
        <Field label="Причина (обязательно)"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
    </Drawer>
  )
}
