// lib/crm/client-validate.ts — валидация тела клиента для POST/PATCH API.
// Возвращает уже нормализованные поля под колонки crm_clients (snake_case).

import { normalizePhone } from './phone'

export const CLIENT_STATUSES = [
  'new',
  'in_progress',
  'waiting',
  'customer',
  'sleeping',
  'lost',
] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export interface ClientInput {
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  status: ClientStatus
  source: string | null
  avg_check: number | null
  note: string | null
  next_contact_at: string | null
}

export type ValidateClientResult =
  | { ok: true; value: Partial<ClientInput> }
  | { ok: false; error: string }

const NAME_MAX = 120
const EMAIL_MAX = 200
const SOURCE_MAX = 40
const NOTE_MAX = 2000

function capString(v: unknown, max: number): string | null {
  if (v == null) return null
  const s = String(v).trim().slice(0, max)
  return s.length ? s : null
}

function parseAvgCheck(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === '') return { ok: true, value: null }
  // Принимаем только число или числовую строку — не boolean/массив/объект
  // (иначе Number(true)===1, Number([42])===42 просочились бы как «сумма»).
  if (typeof v !== 'number' && typeof v !== 'string') return { ok: false }
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n }
}

function parseIsoDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v === '') return { ok: true, value: null }
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return { ok: false }
  return { ok: true, value: d.toISOString() }
}

/**
 * @param opts.partial — режим PATCH: name не обязателен, в value попадают только
 *   переданные ключи (чтобы не затирать колонки значениями по умолчанию).
 */
export function validateClient(
  body: unknown,
  opts: { partial?: boolean } = {},
): ValidateClientResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>
  const partial = opts.partial === true
  const value: Partial<ClientInput> = {}

  // name — обязателен в full-режиме
  const hasName = b.name != null
  if (hasName || !partial) {
    if (b.name != null && typeof b.name !== 'string') {
      return { ok: false, error: 'name must be a string' }
    }
    const name = String(b.name ?? '').trim()
    if (!name) return { ok: false, error: 'name required' }
    if (name.length > NAME_MAX) return { ok: false, error: 'name too long' }
    value.name = name
  }

  // phone — принимаем поле `phone` (или `phone_raw`) как ввод пользователя
  if ('phone' in b || 'phone_raw' in b) {
    const rawInput = String(b.phone ?? b.phone_raw ?? '')
    const { e164, raw } = normalizePhone(rawInput)
    value.phone = e164
    value.phone_raw = raw.trim() ? raw : null
  }

  // status
  if (b.status != null) {
    const s = String(b.status)
    if (!(CLIENT_STATUSES as readonly string[]).includes(s)) {
      return { ok: false, error: 'invalid status' }
    }
    value.status = s as ClientStatus
  } else if (!partial) {
    value.status = 'new'
  }

  // avg_check
  if ('avg_check' in b) {
    const r = parseAvgCheck(b.avg_check)
    if (!r.ok) return { ok: false, error: 'avg_check must be a finite number >= 0' }
    value.avg_check = r.value
  }

  // email / source / note — строки с капами
  if ('email' in b) value.email = capString(b.email, EMAIL_MAX)
  if ('source' in b) value.source = capString(b.source, SOURCE_MAX)
  if ('note' in b) value.note = capString(b.note, NOTE_MAX)

  // next_contact_at — ISO или null
  if ('next_contact_at' in b) {
    const r = parseIsoDate(b.next_contact_at)
    if (!r.ok) return { ok: false, error: 'next_contact_at must be an ISO date or null' }
    value.next_contact_at = r.value
  }

  return { ok: true, value }
}
