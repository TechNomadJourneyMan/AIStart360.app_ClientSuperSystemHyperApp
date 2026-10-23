'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SurveyAnswersView } from '@/components/onboarding/answers/SurveyAnswersView'
import { fileHref, isSurveyFileKey, surveyFileRef } from '@/lib/documents/survey-files'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

interface Payload {
  answers: Record<string, unknown>
  attribution: Record<string, AnswerAttribution>
  ownerName: string | null
  viewerId: string
  canEdit: boolean
}

function fileLink(key: string, raw: unknown): string | null {
  const ref = isSurveyFileKey(key) ? surveyFileRef(raw) : null
  return ref ? fileHref(ref) : null
}

/**
 * The client's questionnaire in the expert cabinet (spec 2026-10-23 §6.5, PO
 * §18.3 item 3): the same view as the client's «Мои ответы», with the author
 * and path of every answer. An expert edits answers of an assigned client with
 * a reason; the client is notified (GET/PATCH /api/expert/clients/[id]/survey).
 */
export function ExpertSurveyPanel({ clientId, onOpenChat }: {
  clientId: string
  /** «Открыть беседу» at an answer through the AI helper (survey Ф5). */
  onOpenChat?: (key: string) => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/survey`, { credentials: 'include' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить анкету')
      setData(json.data as Payload)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить анкету')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const viewer = useMemo(() => ({ viewerId: data?.viewerId ?? null, ownerName: data?.ownerName ?? null }), [data?.viewerId, data?.ownerName])

  const save = useCallback(async (key: string, value: unknown, reason?: string) => {
    if (value === null) return { ok: false as const, error: 'Удалить ответ может только администратор. Укажите значение или «Не знаю».' }
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/survey`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: { [key]: value }, reason }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) return { ok: false as const, error: json?.error || 'Не удалось сохранить' }
      await load()
      return { ok: true as const }
    } catch {
      return { ok: false as const, error: 'Нет связи с сервером' }
    }
  }, [clientId, load])

  if (error) return <p role="alert" className="rounded-xl border border-error/30 bg-error/[0.06] px-4 py-3 text-sm text-error">{error}</p>
  if (!data) return <p className="px-1 py-6 text-sm text-on-surface-variant">Загружаем анкету…</p>
  return (
    <SurveyAnswersView
      answers={data.answers}
      attribution={data.attribution}
      viewer={viewer}
      mode="staff"
      canEdit={data.canEdit}
      reason="required"
      onSave={save}
      fileLink={fileLink}
      onOpenChat={onOpenChat}
    />
  )
}
