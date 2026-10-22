/**
 * lib/ui/pending.ts — what an action button says while its request runs (W4, PO 2026-10-22: «если
 * страница/действие загружается — показывать статус, чтобы пользователь знал, что не зависло»).
 *
 * The button is disabled and its label changes to the pending one until the request answers; one
 * wording per kind of action across the cabinet.
 */
export const PENDING_LABEL = {
  save: 'Сохраняем…',
  delete: 'Удаляем…',
  send: 'Отправляем…',
  apply: 'Применяем…',
  link: 'Привязываем…',
  unlink: 'Отвязываем…',
  disable: 'Отключаем…',
  reissue: 'Перевыпускаем…',
} as const

export type PendingKind = keyof typeof PENDING_LABEL

/** The label of an action button: the idle one, or the pending one of its kind while the request runs. */
export function actionLabel(idle: string, pending: boolean, kind: PendingKind = 'save'): string {
  return pending ? PENDING_LABEL[kind] : idle
}

/**
 * Which of several buttons of one row is running: `pendingKey === key`. A row with one mutation for
 * several buttons (e.g. «Верно из анкеты» / «Не важно») shows the label only on the clicked one and
 * keeps all of them disabled.
 */
export function isPendingKey(pendingKey: string | null | undefined, key: string): boolean {
  return pendingKey != null && pendingKey === key
}
