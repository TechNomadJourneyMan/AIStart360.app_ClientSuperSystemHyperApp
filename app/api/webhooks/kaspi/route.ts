export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase-service'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/webhooks/kaspi — платёжный callback Kaspi-эквайринга.
 *
 * Безопасность (ТЗ §10): подпись ОБЯЗАТЕЛЬНА и проверяется fail-closed —
 * без KASPI_WEBHOOK_SECRET endpoint отвечает 503 и ничего не обрабатывает
 * (в отличие от опционального паттерна telegram-webhook). Подпись:
 * HMAC-SHA256(raw body, KASPI_WEBHOOK_SECRET) hex в заголовке
 * `x-kaspi-signature`. Точное имя заголовка сверить с мерчант-документацией
 * Kaspi и при необходимости поправить SIGNATURE_HEADER.
 *
 * Обработка идемпотентна: повторный callback по уже завершённой транзакции
 * отвечает 200 без побочных эффектов.
 *
 * Успешный платёж:
 *   1. payment_transactions.status → succeeded (по externalId = paymentId);
 *   2. upsert подписки (tier pro, status active, период для monthly-планов);
 *   3. profiles.tier → 'pro' (немедленные entitlements, миграция 048);
 *   4. запись в журнал аудита (актор 'kaspi:webhook').
 */

const SIGNATURE_HEADER = 'x-kaspi-signature'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function verifySignature(rawBody: string, provided: string | null, secret: string): boolean {
  if (!provided) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const SUCCESS_STATUSES = new Set(['success', 'succeeded', 'paid', 'processed', 'completed'])
const FAILURE_STATUSES = new Set(['failed', 'canceled', 'cancelled', 'declined', 'error', 'expired'])

async function resolveUserId(orgId: string): Promise<string | null> {
  // orgId в биллинге — companies.id (per-user tenant) либо сам auth user id.
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('companies')
      .select('user_id')
      .eq('id', orgId)
      .maybeSingle()
    const uid = (data as { user_id?: string } | null)?.user_id
    if (uid) return uid
  } catch {
    // companies недоступны — попробуем трактовать orgId как user id ниже.
  }
  return UUID_RE.test(orgId) ? orgId : null
}

export async function POST(req: NextRequest) {
  const secret = process.env.KASPI_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed: непроверяемый платёжный callback опаснее пропущенного.
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  if (!verifySignature(rawBody, req.headers.get(SIGNATURE_HEADER), secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let body: { paymentId?: string; orderId?: string; status?: string; amount?: number }
  try {
    body = JSON.parse(rawBody) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const paymentId = body.paymentId ? String(body.paymentId) : null
  const status = (body.status ?? '').toLowerCase()
  if (!paymentId || !status) {
    return NextResponse.json({ error: 'paymentId and status required' }, { status: 400 })
  }

  const tx = await prisma.paymentTransaction.findFirst({
    where: { externalId: paymentId, provider: 'kaspi' },
  })
  if (!tx) {
    // Неизвестный платёж — фиксируем и отвечаем 200, чтобы Kaspi не ретраил вечно.
    await logAudit({
      entityType: 'system',
      entityId: paymentId,
      action: 'payment.unknown_webhook',
      performedBy: 'kaspi:webhook',
      diff: { after: { status, orderId: body.orderId ?? null } },
    })
    return NextResponse.json({ ok: true, note: 'unknown_payment' })
  }

  // Идемпотентность: терминальные статусы не перезаписываем.
  if (tx.status === 'succeeded' || tx.status === 'failed') {
    return NextResponse.json({ ok: true, note: 'already_finalized' })
  }

  if (SUCCESS_STATUSES.has(status)) {
    // Сверка суммы (если Kaspi прислал): целые KZT из metadata.amountKzt.
    const expectedKzt = (tx.metadata as { amountKzt?: number } | null)?.amountKzt
    if (
      typeof body.amount === 'number' &&
      typeof expectedKzt === 'number' &&
      Math.round(body.amount) !== Math.round(expectedKzt)
    ) {
      await logAudit({
        entityType: 'system',
        entityId: tx.id,
        action: 'payment.amount_mismatch',
        performedBy: 'kaspi:webhook',
        diff: { after: { expectedKzt, receivedKzt: body.amount, paymentId } },
      })
      return NextResponse.json({ error: 'amount_mismatch' }, { status: 409 })
    }

    await prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: { status: 'succeeded' },
    })

    // Подписка: monthly-план получает период, one-time — бессрочный доступ Pro.
    const isMonthly = (tx.planKey ?? '').includes('monthly')
    const currentPeriodEnd = isMonthly
      ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
      : null
    try {
      await prisma.subscription.upsert({
        where: { orgId: tx.orgId },
        create: {
          orgId: tx.orgId,
          tier: 'pro',
          status: 'active',
          provider: 'kaspi',
          currentPeriodEnd,
        },
        update: { tier: 'pro', status: 'active', provider: 'kaspi', currentPeriodEnd },
      })
    } catch (e) {
      console.error('[webhooks/kaspi] subscription upsert failed:', e)
    }

    // Немедленные entitlements: profiles.tier = 'pro' (миграция 048).
    const userId = await resolveUserId(tx.orgId)
    if (userId) {
      try {
        const svc = createServiceClient()
        await svc.from('profiles').update({ tier: 'pro' }).eq('id', userId)
      } catch (e) {
        console.error('[webhooks/kaspi] profiles.tier update failed:', e)
      }
    }

    await logAudit({
      entityType: 'user',
      entityId: userId ?? tx.orgId,
      action: 'payment.succeeded',
      performedBy: 'kaspi:webhook',
      diff: {
        after: {
          transactionId: tx.id,
          paymentId,
          planKey: tx.planKey,
          amount: tx.amount,
          currency: tx.currency,
          tier: 'pro',
        },
      },
    })

    return NextResponse.json({ ok: true })
  }

  if (FAILURE_STATUSES.has(status)) {
    await prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: { status: 'failed' },
    })
    await logAudit({
      entityType: 'system',
      entityId: tx.id,
      action: 'payment.failed',
      performedBy: 'kaspi:webhook',
      diff: { after: { paymentId, providerStatus: status } },
    })
    return NextResponse.json({ ok: true })
  }

  // Промежуточный статус — принимаем без изменений.
  return NextResponse.json({ ok: true, note: 'intermediate_status' })
}
