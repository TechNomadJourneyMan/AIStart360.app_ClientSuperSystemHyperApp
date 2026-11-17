/**
 * lib/registration/entry.ts — что показывает вход (/, /login, /register) по
 * режиму регистрации (Раунд 4, B3: N4B-3, R-051, R-104). Только сервер.
 *
 * Страницы входа читают режим на сервере и передают формам готовые флаги —
 * форма больше не показывает то, что API всё равно отвергнет (регистрация и
 * демо в режиме «по приглашению» отвечали 403).
 */
import { getAutoApproveClients, getRegistrationMode, type RegistrationMode } from '@/lib/settings/system-settings'
import { registrationWaitText } from './wait-text'

type Env = Record<string, string | undefined>

/**
 * Открыт ли демо-доступ. ТО ЖЕ условие, что у POST /api/auth/demo-access:
 * выключен переменной DEMO_ACCESS_ENABLED=false и закрыт в режиме «по приглашению».
 */
export function demoAccessOpen(mode: RegistrationMode, env: Env = process.env): boolean {
  return env.DEMO_ACCESS_ENABLED !== 'false' && mode !== 'invite'
}

/**
 * Ссылка «О платформе» на внешний сайт продукта. Лендинг сейчас отвечает 402
 * (решение PO: не переносить), поэтому ссылка скрыта, пока сайт не заработает:
 * вернуть — PRODUCT_SITE_LINK=on в переменных сервиса портала (без сборки).
 */
export function productSiteLinkVisible(env: Env = process.env): boolean {
  return env.PRODUCT_SITE_LINK === 'on'
}

export interface AuthEntry {
  mode: RegistrationMode
  demoOpen: boolean
  /** Подсказка под кнопкой регистрации (R-104). */
  waitText: string
  showProductSite: boolean
}

/** Режим регистрации и всё, что от него зависит на экранах входа. Не бросает (режим — fail-safe). */
export async function loadAuthEntry(env: Env = process.env): Promise<AuthEntry> {
  const mode = await getRegistrationMode()
  const autoApprove = mode === 'approval' ? await getAutoApproveClients() : false
  return {
    mode,
    demoOpen: demoAccessOpen(mode, env),
    waitText: registrationWaitText(mode, autoApprove),
    showProductSite: productSiteLinkVisible(env),
  }
}
