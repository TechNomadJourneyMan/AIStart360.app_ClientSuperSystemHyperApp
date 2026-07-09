/**
 * lib/crm/digest.ts — чистые хелперы утреннего CRM-дайджеста (Фаза 4A).
 *
 * Вся выборка каналов и сборка текста — детерминированные функции без сети и БД,
 * чтобы cron-роут остался тонким, а логику покрыли юнит-тесты. Один и тот же
 * контент рендерится в in-app / email / Telegram (последний — с HTML-экранированием).
 */

/** Русская форма множественного числа (1 / 2-4 / 5+). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

export interface DigestData {
  overdue: number
  sleeping: number
  /** Самый слабый блок GRI из текущей диагностики (довесок №9), либо null. */
  weakBlock: { label: string; score: number } | null
}

export interface DigestChannels {
  inApp: boolean
  email: boolean
  telegram: boolean
}

interface NotifCrmPrefs {
  in_app?: boolean
  email?: boolean
  telegram?: boolean
}

/**
 * Каналы доставки из preferences.notifications.crm (по умолчанию всё включено),
 * с учётом наличия адреса/чата. Канал считается включённым, если пользователь
 * его явно не выключил (!== false) И есть куда слать.
 */
export function selectChannels(
  prefs: unknown,
  opts: { hasEmail: boolean; hasTelegram: boolean },
): DigestChannels {
  const crm =
    (prefs as { notifications?: { crm?: NotifCrmPrefs } } | null)?.notifications?.crm ?? {}
  return {
    inApp: crm.in_app !== false,
    email: crm.email !== false && opts.hasEmail,
    telegram: crm.telegram !== false && opts.hasTelegram,
  }
}

/** RU-подписи 7 блоков GRI (sections.ts хранит английские shortTitle). */
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

/** Самый слабый блок из section_avgs ({sectionId: number}), либо null. */
export function pickWeakestBlock(sectionAvgs: unknown): { label: string; score: number } | null {
  if (!sectionAvgs || typeof sectionAvgs !== 'object') return null
  let best: { label: string; score: number } | null = null
  for (const [id, raw] of Object.entries(sectionAvgs as Record<string, unknown>)) {
    const score = Number(raw)
    if (!Number.isFinite(score)) continue
    const label = BLOCK_RU[id] ?? id
    if (!best || score < best.score) best = { label, score }
  }
  return best
}

/** Заголовок дайджеста по суммарному числу клиентов. */
export function buildDigestTitle(data: DigestData): string {
  const total = data.overdue + data.sleeping
  return `📞 CRM: ${total} ${plural(total, 'клиент ждёт', 'клиента ждут', 'клиентов ждут')} внимания`
}

/** Содержательные строки дайджеста (общие для всех каналов). */
export function buildDigestLines(data: DigestData): string[] {
  const lines: string[] = []
  if (data.overdue > 0) lines.push(`Просроченных напоминаний: ${data.overdue}`)
  if (data.sleeping > 0) lines.push(`Спящих клиентов: ${data.sleeping}`)
  if (data.weakBlock) {
    lines.push(
      `Слабый блок GRI: ${data.weakBlock.label} (${data.weakBlock.score.toFixed(1)}/10) — уделите ему внимание на этой неделе.`,
    )
  }
  return lines
}

/** Тело для in-app / email (плоский текст). */
export function buildDigestBody(data: DigestData): string {
  return `${buildDigestLines(data).join(' · ')}. Откройте раздел «Клиенты».`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** HTML-сообщение для Telegram (parse_mode=HTML). */
export function buildTelegramDigest(data: DigestData, url: string): string {
  const head = `<b>${escapeHtml(buildDigestTitle(data))}</b>`
  const body = buildDigestLines(data).map(escapeHtml).join('\n')
  const link = url ? `\n\n<a href="${escapeHtml(url)}">Открыть «Клиенты»</a>` : ''
  return `${head}\n${body}${link}`
}
