/**
 * components/giga-panel/invite-request-model.ts — «Запрос приглашения» в ГИГА
 * «Заявки» → «Регистрация» (Раунд 4, B3, N4B-3), без DOM — проверяется тестом.
 *
 * Человек без аккаунта попросил приглашение (регистрация по приглашению).
 * Принять его — значит отправить приглашение: POST
 * /api/giga-admin/requests/:id/invite (lib/admin/invites.ts, право users.invite);
 * заявка закрывается как принятая. Отклонить / в архив — как любую заявку;
 * письма об отказе нет (аккаунта нет).
 */
import { isInviteRequestRow } from '@/lib/registration/invite-request-shared'

export const INVITE_REQUEST_BADGE = 'Запрос приглашения'
export const SEND_INVITE_LABEL = 'Отправить приглашение'
export const SEND_INVITE_PERMISSION = 'users.invite'
export const SEND_INVITE_NO_RIGHT = 'Отправить приглашение может сотрудник с правом «Приглашения на платформу»'
/** Массовое «Принять все» запрос приглашения не закрывает. */
export const BULK_INVITE_NOTE = 'Запросы приглашения закрываются кнопкой «Отправить приглашение» в карточке'
/** Добавка к тексту массового отклонения: кто письма не получит. */
export const BULK_REJECT_INVITE_NOTE = 'Запросившим приглашение письмо не уходит — аккаунта у них нет.'

/** Карточка — запрос приглашения? */
export function isInviteRequest(r: { category?: string | null; source?: string | null }): boolean {
  return isInviteRequestRow(r)
}

/**
 * Ревью W3A-5: повторный запрос на ту же почту с другими данными. Почту может
 * ввести кто угодно — поэтому исходная заявка не меняется, а повтор показан
 * отдельно: сотрудник не свяжется по чужому контакту, не заметив подмены.
 */
export function otherRequestText(o: { name?: string | null; company?: string | null; contact?: string | null; at?: string | null }): string {
  const who = [o.name, o.company].filter((v) => !!v && String(v).trim()).join(' · ') || 'без имени'
  const when = o.at && Number.isFinite(Date.parse(o.at))
    ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(o.at))
    : null
  return `Повторный запрос с другими данными${when ? ` (${when})` : ''}: ${who}${o.contact ? ` · ${o.contact}` : ''}. Сверьте с первым запросом, прежде чем связываться.`
}

/** Текст диалога «Отправить приглашение». */
export function sendInviteDialogText(r: { accountExists?: boolean }): string[] {
  return [
    r.accountExists
      ? 'Аккаунт с этой почтой уже есть — уйдёт письмо со ссылкой для входа.'
      : 'На почту из заявки уйдёт письмо-приглашение: человек задаст пароль и войдёт. Ссылка в письме действует один час — если не успеет, отправьте приглашение ещё раз в «Приглашения».',
    'Заявка закроется как принятая. Новый аккаунт клиента после входа ждёт одобрения в этой же вкладке «Регистрация» — примите его, чтобы открыть кабинет.',
    'Письмо уходит от имени AIStart360 «по вашей заявке» — без имени и компании из формы.',
  ]
}

export type SendInviteOutcome = { ok: boolean; text: string }

/** POST «Отправить приглашение»; ответ — текст для тоста. */
export async function sendInviteFromRequest(fetchFn: typeof fetch, requestId: string): Promise<SendInviteOutcome> {
  try {
    const res = await fetchFn(`/api/giga-admin/requests/${encodeURIComponent(requestId)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    })
    const d = (await res.json().catch(() => null)) as { ok?: boolean; outcome?: string; message?: string; error?: string } | null
    if (!res.ok || !d?.ok) return { ok: false, text: d?.error || `Не удалось отправить приглашение (HTTP ${res.status})` }
    return {
      ok: true,
      text: d.outcome === 'relinked'
        ? 'Аккаунт уже был — отправлена ссылка для входа; заявка закрыта.'
        : 'Приглашение отправлено; заявка закрыта.',
    }
  } catch {
    return { ok: false, text: 'Нет связи с сервером' }
  }
}
