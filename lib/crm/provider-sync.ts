/**
 * lib/crm/provider-sync.ts — маппинг записей внешней CRM (AmoCRM/Bitrix24) в
 * черновики clients нашей базы (Фаза 4B). Чистая функция без сети/БД: контакты +
 * сделки → дедуплицированные ProviderClientDraft (ключ — E.164 телефон, иначе имя).
 * avg_check считается средним по суммам сделок клиента.
 */

import { normalizePhone } from '@/lib/crm/phone'
import type { CrmContact, CrmDeal, CrmProvider } from '@/lib/crm/types'

export interface ProviderClientDraft {
  name: string
  phone: string | null // нормализованный E.164 или null
  phone_raw: string | null
  email: string | null
  avg_check: number | null
  source: CrmProvider
}

/** Ключ дедупликации: E.164 телефон, иначе имя (в нижнем регистре). */
function draftKey(phoneRaw: string | null | undefined, name: string): string | null {
  const e164 = phoneRaw ? normalizePhone(phoneRaw).e164 : null
  if (e164) return e164
  const n = name.trim().toLowerCase()
  return n ? `name:${n}` : null
}

export function mapProviderRecords(
  provider: CrmProvider,
  contacts: CrmContact[],
  deals: CrmDeal[],
): ProviderClientDraft[] {
  const byKey = new Map<string, ProviderClientDraft>()

  const upsertDraft = (
    name: string,
    phoneRaw: string | null,
    email: string | null,
  ): string | null => {
    const trimmed = name.trim()
    const key = draftKey(phoneRaw, trimmed)
    if (!key) return null
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: trimmed || 'Без имени',
        phone: phoneRaw ? normalizePhone(phoneRaw).e164 : null,
        phone_raw: phoneRaw ?? null,
        email: email ?? null,
        avg_check: null,
        source: provider,
      })
    }
    return key
  }

  // 1) Контакты — основа клиентской базы.
  for (const c of contacts) {
    if (!c.name?.trim()) continue
    upsertDraft(c.name, c.phone ?? null, c.email ?? null)
  }

  // 2) Сделки — заводят недостающих клиентов и дают avg_check (среднее по суммам).
  const sums = new Map<string, { sum: number; count: number }>()
  for (const d of deals) {
    const name = (d.contactName || d.companyTitle || d.title || '').trim()
    const key = upsertDraft(name, d.contactPhone ?? null, d.contactEmail ?? null)
    if (!key) continue
    const amount = Number(d.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const cur = sums.get(key) ?? { sum: 0, count: 0 }
    cur.sum += amount
    cur.count += 1
    sums.set(key, cur)
  }
  for (const [key, s] of sums) {
    const draft = byKey.get(key)
    if (draft && s.count > 0) draft.avg_check = Math.round(s.sum / s.count)
  }

  return Array.from(byKey.values())
}
