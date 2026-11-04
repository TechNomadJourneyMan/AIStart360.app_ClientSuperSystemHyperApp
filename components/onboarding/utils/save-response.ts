export interface SurveySavePayload {
  ok?: boolean
  error?: string
  data?: {
    point_a_sync?: { error?: string }
    sheet_sync?: { status?: string; reason?: string }
  }
}

export function surveySaveError(
  responseOk: boolean,
  payload: SurveySavePayload,
): string | null {
  if (!responseOk || !payload.ok) {
    return payload.error || 'Не удалось сохранить ответы анкеты'
  }
  if (payload.data?.point_a_sync?.error) {
    return 'Ответы сохранены, но Точка А ещё не обновилась. Повторите сохранение.'
  }
  return null
}

export function sheetProjectionWarning(
  payload: SurveySavePayload,
): string | null {
  const sync = payload.data?.sheet_sync
  if (sync?.status !== 'failed' && sync?.status !== 'skipped') return null
  return sync.reason || sync.status
}
