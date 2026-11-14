/**
 * components/giga-panel/user360/free-client-copy.ts — the texts User 360 shows the
 * expert BEFORE a comment / a review goes to the client (R2-C, verify H-1).
 *
 * The expert's comments and review are part of Точка А (decision of the PO,
 * M-4). For a client with Точка А closed (`clientPaidLocked` from the server,
 * one batch decision; a failed decision → no flag → the usual text) the
 * promise «клиент увидит комментарий» is not true: he gets only a notice
 * without the text (lib/notifications.ts, …/review/publish) and sees the
 * content once the access is opened.
 */
import { pluralComments } from '@/lib/email/templates'

export const COMMENT_FREE_NOTE =
  'Клиент на бесплатном тарифе: он получит только уведомление без текста комментария, а сам комментарий увидит после открытия доступа (Точка А).'

export function commentComposerHint(clientPaidLocked?: boolean): string {
  return clientPaidLocked ? COMMENT_FREE_NOTE : 'Клиент увидит комментарий в кабинете рядом с выбранным блоком и получит уведомление.'
}

export function commentsEmptyHint(clientPaidLocked?: boolean): string {
  return clientPaidLocked
    ? 'Комментарии клиент увидит после открытия доступа (Точка А); пока он получит только уведомление без текста.'
    : 'Первый комментарий клиент увидит у себя в кабинете.'
}

export function commentSentToast(clientPaidLocked?: boolean): string {
  return clientPaidLocked ? 'Комментарий сохранён. Клиент на бесплатном тарифе получил уведомление без текста.' : 'Комментарий отправлен клиенту'
}

/** The confirmation of «Опубликовать разбор». */
export function reviewPublishText(count: number, blocks: number, clientPaidLocked?: boolean): string {
  return clientPaidLocked
    ? `Клиент на бесплатном тарифе получит одно письмо и одно уведомление «Эксперт подготовил разбор» — без текста комментариев. Сами ${pluralComments(count)} он увидит после открытия доступа (Точка А).`
    : `Клиент увидит ${pluralComments(count)} в ${blocks} блок(ах) и получит одно письмо «Эксперт подготовил разбор» и одно уведомление в кабинете.`
}
