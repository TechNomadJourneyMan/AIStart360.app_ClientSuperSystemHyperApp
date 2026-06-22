import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { authRateLimit } from '@/lib/rate-limit'
import { sendNotificationEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Persist a mini-GRI lead via the Supabase service-role PostgREST API instead of
 * Prisma. The public lead-magnet must NOT depend on the pgBouncer pooler (which
 * can cold-start and 500), and the persist itself is BEST-EFFORT: any failure is
 * logged and swallowed so the wizard always unlocks (mirrors /api/checkout +
 * lib/share/tokens.ts). Returns true on success, false otherwise.
 *
 * `mini_gri_leads` columns (033_app_share_payments_leads.sql / Prisma @map):
 * id, email, locale, answers(jsonb), overall_score, block_scores(jsonb), source,
 * converted(default false), createdAt(default now). Only `id` lacks a DB default.
 */
async function persistMiniGriLead(lead: {
  email: string
  locale: string
  answers: unknown
  overallScore: number
  blockScores: unknown
}): Promise<boolean> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  if (!url || !key) {
    console.warn('[mini-gri] missing Supabase env — skipping lead persist')
    return false
  }

  try {
    const res = await fetch(`${url}/rest/v1/mini_gri_leads`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      cache: 'no-store',
      body: JSON.stringify({
        // id has no DB default (Prisma normally supplies a cuid) — generate one.
        id: 'mgl_' + randomBytes(16).toString('base64url'),
        email: lead.email,
        locale: lead.locale,
        answers: lead.answers,
        overall_score: lead.overallScore,
        block_scores: lead.blockScores,
        source: 'gri-free',
      }),
    })
    if (!res.ok) {
      console.warn(
        `[mini-gri] lead persist failed ${res.status}: ${await res
          .text()
          .catch(() => '')}`,
      )
      return false
    }
    return true
  } catch (err) {
    console.warn('[mini-gri] lead persist transport error (non-fatal)', err)
    return false
  }
}

// In-memory fallback so the public endpoint is never fully unprotected when
// Upstash is not configured (mirrors app/api/giga-admin/auth/route.ts).
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 6
const memHits = new Map<string, { count: number; resetAt: number }>()

function memoryLimited(ip: string): boolean {
  const now = Date.now()
  const cur = memHits.get(ip)
  if (!cur || cur.resetAt < now) {
    memHits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  cur.count += 1
  return cur.count > MAX_ATTEMPTS
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

const blockScoreSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
})

const bodySchema = z.object({
  email: z.string().email().max(254),
  answers: z.record(z.unknown()),
  overallScore: z.number().int().min(0).max(100),
  blockScores: z.array(blockScoreSchema).min(1),
  locale: z.string().max(10).optional(),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  // Rate limit before doing any work.
  if (authRateLimit) {
    const { success } = await authRateLimit.limit(`mini-gri:${ip}`)
    if (!success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  } else if (memoryLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const { email, answers, overallScore, blockScores, locale } = parsed.data

  // Persist the lead — BEST-EFFORT. A persist failure must never lose the lead's
  // unlock or block the capture email, so we log and continue regardless.
  await persistMiniGriLead({
    email,
    locale: locale ?? 'ru',
    answers,
    overallScore,
    blockScores,
  })

  // Fire-and-forget capture email. Never block the response on email failure.
  try {
    const weakest = [...blockScores].sort((a, b) => a.score - b.score)[0]
    await sendNotificationEmail({
      to: email,
      subject: 'Ваш мини-GRI — предварительная оценка бизнеса',
      title: `Ваш GRI: ${overallScore}/100`,
      body: `Спасибо за прохождение мини-диагностики! Слабейший блок — «${weakest?.label ?? '—'}» (${weakest?.score ?? 0}/100). Зарегистрируйтесь, чтобы открыть полный GRI по 7 блокам и получить персональный план роста.`,
      ctaLabel: 'Получить полный GRI',
      ctaUrl: 'https://aistart360.com/register',
    })
  } catch (err) {
    console.error('[mini-gri] capture email failed (non-blocking)', err)
  }

  return NextResponse.json({ ok: true })
}
