/**
 * lib/whatsapp/link-api.ts — the HTTP contract of «Мой WhatsApp», shared by
 *   /api/whatsapp/link            client (Настройки › Уведомления), kind 'client'
 *   /api/expert/whatsapp-link     expert cabinet, kind 'expert'
 *   /api/giga-admin/whatsapp-link GIGA «Уведомления», kind 'staff'
 *
 *   GET                         → LinkStatus
 *   POST {action:'start', phone, consent:true}  → send a 6-digit code (10 min)
 *   POST {action:'confirm', code}               → verify + opt in
 *   POST {action:'opt_in'} / {action:'opt_out'} → toggle on the verified number
 *   POST {action:'prefs', minLevel?, mutedUntil?}
 *   DELETE                      → forget the number
 * The routes authenticate and pick the kind; nothing here trusts the body for identity.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { confirmVerification, getLinkStatus, optIn, optOut, removeLink, startVerification, updatePreferences } from './links'
import type { RecipientKind } from './outbox'

const LEVEL = z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'])

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), phone: z.string().min(5).max(32), consent: z.boolean() }),
  z.object({ action: z.literal('confirm'), code: z.string().min(4).max(12) }),
  z.object({ action: z.literal('opt_in') }),
  z.object({ action: z.literal('opt_out') }),
  z.object({
    action: z.literal('prefs'),
    minLevel: LEVEL.optional(),
    mutedUntil: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
  }),
])

const ERRORS: Record<string, { status: number; error: string }> = {
  invalid_phone: { status: 400, error: 'Номер не распознан. Укажите его в международном формате, например +7 700 123 45 67' },
  consent_required: { status: 400, error: 'Подтвердите согласие получать уведомления в WhatsApp' },
  not_configured: { status: 503, error: 'WhatsApp пока не подключён на платформе. Обратитесь к администратору' },
  rate_limited: { status: 429, error: 'Слишком много попыток. Попробуйте позже' },
  send_failed: { status: 502, error: 'Не удалось отправить код в WhatsApp. Проверьте номер и попробуйте ещё раз' },
  invalid_code: { status: 400, error: 'Неверный код' },
  expired: { status: 400, error: 'Код истёк или не запрашивался. Запросите новый' },
  too_many_attempts: { status: 400, error: 'Слишком много неверных попыток. Запросите новый код' },
  not_verified: { status: 400, error: 'Сначала подтвердите номер кодом' },
  no_link: { status: 404, error: 'Номер WhatsApp не привязан' },
}

function fail(code: string, retryAfterSeconds?: number): NextResponse {
  const e = ERRORS[code] ?? { status: 400, error: 'Ошибка' }
  return NextResponse.json(
    { ok: false, code, error: e.error },
    { status: e.status, headers: retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : undefined },
  )
}

export async function whatsappLinkGet(userId: string, kind: RecipientKind): Promise<NextResponse> {
  return NextResponse.json({ ok: true, ...(await getLinkStatus(userId, kind)) })
}

export async function whatsappLinkPost(req: Request, userId: string, kind: RecipientKind): Promise<NextResponse> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 })
  const b = parsed.data

  switch (b.action) {
    case 'start': {
      const r = await startVerification(userId, kind, b.phone, b.consent)
      if (!r.ok) return fail(r.code, r.retryAfterSeconds)
      return NextResponse.json({ ok: true, expiresAt: r.expiresAt, phoneMasked: r.phoneMasked, delivery: r.delivery })
    }
    case 'confirm': {
      const r = await confirmVerification(userId, kind, b.code)
      if (!r.ok) return fail(r.code, r.retryAfterSeconds)
      return whatsappLinkGet(userId, kind)
    }
    case 'opt_in':
      if (!(await optIn(userId, kind))) return fail('not_verified')
      return whatsappLinkGet(userId, kind)
    case 'opt_out':
      await optOut(userId, kind)
      return whatsappLinkGet(userId, kind)
    case 'prefs': {
      const ok = await updatePreferences(userId, kind, {
        minLevel: b.minLevel,
        mutedUntil: b.mutedUntil === undefined ? undefined : b.mutedUntil === null ? null : new Date(b.mutedUntil),
      })
      if (!ok) return fail('no_link')
      return whatsappLinkGet(userId, kind)
    }
  }
}

export async function whatsappLinkDelete(userId: string, kind: RecipientKind): Promise<NextResponse> {
  await removeLink(userId, kind)
  return NextResponse.json({ ok: true })
}
