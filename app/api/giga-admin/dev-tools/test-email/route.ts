export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendTransactionalEmail } from '@/lib/email/send'
import { getSiteUrl } from '@/lib/site-url'
import { TEST_EMAIL_TEMPLATE_KEYS } from '@/lib/devtools/tools'
import { buildSampleEmail } from '@/lib/devtools/email-samples'

/**
 * POST /api/giga-admin/dev-tools/test-email { template } — отправить письмо-
 * образец на СВОЙ адрес (email аккаунта Super Admin; другой адрес передать
 * нельзя). Идемпотентность выключена, как в scripts/send-test-emails.ts;
 * предохранитель sendTransactionalEmail (без писем из тестов) действует.
 */
const bodySchema = z.object({ template: z.enum(TEST_EMAIL_TEMPLATE_KEYS) })

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'devtools.use')
  if (guard.response) return guard.response
  const actor = guard.actor
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Выберите шаблон письма' }, { status: 400 })
  if (await isRateLimitedKey(actor.id, 'devtools-test-email', { max: 10, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Не больше 10 тестовых писем в час' }, { status: 429 })
  }

  const { data: profile } = await createServiceClient().from('profiles').select('email, full_name').eq('id', actor.id).maybeSingle()
  const p = profile as { email?: string | null; full_name?: string | null } | null
  const to = (p?.email || actor.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return NextResponse.json({ ok: false, error: 'У вашего аккаунта нет корректного email' }, { status: 409 })

  const { kind, built } = buildSampleEmail(parsed.data.template, { base: getSiteUrl(), name: p?.full_name ?? null })
  const res = await sendTransactionalEmail({
    kind, to, subject: built.subject, content: built.content,
    userId: actor.id, dedupeKey: null, metadata: { qa: true, source: 'devtools', template: parsed.data.template },
  })

  await recordAdminAction(actor, {
    action: 'devtools.test_email',
    entityType: 'devtools', entityId: actor.id, targetUserId: actor.id,
    metadata: { template: parsed.data.template, ok: res.ok, skipped: res.skipped ?? false, error: res.error ?? null },
  }, req).catch(() => false)

  if (!res.ok) return NextResponse.json({ ok: false, error: `Письмо не отправлено: ${res.error ?? 'ошибка'}` }, { status: 502 })
  return NextResponse.json({ ok: true, to, skipped: res.skipped ?? false, providerId: res.providerId ?? null })
}
