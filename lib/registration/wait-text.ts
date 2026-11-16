/**
 * lib/registration/wait-text.ts — что обещать человеку на входе (Раунд 4, B3).
 *
 * Без серверных зависимостей: тексты нужны и серверным страницам (/, /register),
 * и клиентским (форма, зал ожидания).
 *
 * R-104: раньше форма регистрации обещала «в течение 1 рабочего дня» и
 * «уведомление по email», зал ожидания — «обычно в течение 24 часов». Ни срока,
 * ни настройки под него нет, а при авто-одобрении письма нет вовсе (человек
 * сразу в кабинете, app/api/auth/register/route.ts — sendEmail:false). Теперь
 * один текст по режиму регистрации и тумблеру авто-одобрения, и письмо
 * обещается только там, где оно уходит: ручное одобрение в ГИГА / Telegram идёт
 * через applyApprovalDecision → sendPortalAccessGrantedEmail (lib/users/approval.ts).
 *
 * N4B-3: в режиме «по приглашению» регистрации нет — вместо формы «Запросить
 * приглашение» (POST /api/auth/request-invite). Срок ответа на такой запрос
 * никто не назначал — его и не обещаем.
 */

export type EntryRegistrationMode = 'open' | 'approval' | 'invite'

/** Подсказка под кнопкой регистрации (режимы «открытая» и «по подтверждению»). */
export function registrationWaitText(mode: EntryRegistrationMode, autoApprove: boolean): string {
  if (mode === 'open') return 'Доступ к кабинету откроется сразу после регистрации.'
  if (mode === 'invite') return INVITE_ONLY_LEAD
  if (autoApprove) {
    return 'Обычно доступ к кабинету открывается сразу после регистрации. Если заявке нужна ручная проверка, её рассмотрит администратор — когда доступ откроют, на указанную почту придёт письмо.'
  }
  return 'Заявку рассмотрит администратор. Когда доступ откроют, на указанную почту придёт письмо.'
}

/** Зал ожидания: сюда попадает только тот, кого проверяют вручную. */
export const APPROVAL_WAIT_NOTE =
  'Заявку рассмотрит администратор. Когда доступ откроют, на вашу почту придёт письмо, а эта страница обновится сама.'

export const INVITE_ONLY_TITLE = 'Регистрация по приглашению'

export const INVITE_ONLY_LEAD =
  'Аккаунт на платформе открывает команда AIStart360 и присылает приглашение на почту. Оставьте заявку — команда свяжется с вами.'

/** Ответ на «Запросить приглашение» — без срока, которого никто не обещал. */
export const INVITE_REQUEST_ACCEPTED =
  'Заявка принята. Команда AIStart360 свяжется с вами. Если доступ откроют, приглашение придёт письмом на указанную почту.'

/**
 * /register?notice=invite_only — сюда возвращает любой вход без приглашения: Google (app/auth/callback),
 * пароль, ссылка на почту, первая страница кабинета (staging-проход волны 3: «Google» в тексте сбивал
 * вошедшего паролем).
 */
export const INVITE_ONLY_NOTICE_PARAM = 'invite_only'

export const GOOGLE_INVITE_ONLY_NOTICE =
  'Войти могут только те, кого пригласила или одобрила команда AIStart360. Оставьте заявку — команда свяжется с вами.'

/** Текст пометки для `?notice=` страницы /register; неизвестное значение — null. */
export function registerNotice(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === INVITE_ONLY_NOTICE_PARAM ? GOOGLE_INVITE_ONLY_NOTICE : null
}
