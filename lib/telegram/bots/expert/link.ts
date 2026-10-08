/**
 * Binding a Telegram account to an expert in the expert bot
 * (telegram_bot_links, bot = 'expert', migration 095).
 *
 * Same mechanism as the staff link (lib/telegram/staff-link.ts) with its own
 * table row and prefix: the expert asks their cabinet (/expert/profile →
 * «Привязать Telegram») for a link; only the SHA-256 of a random code is
 * stored with a 15-minute TTL; t.me/<expert bot>?start=expert_<code> binds
 * the sender. Access is re-checked on every update: an approved profile whose
 * role is one of EXPERT_ROLES (expert / admin / super_admin), or the person is
 * a SuperExpert (staff_roles) — lib/expert-auth.ts isExpertBotMember.
 */
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { expertBotRole, isExpertBotMember } from '@/lib/expert-auth'
import { deepLink } from '../registry'

const TTL_MINUTES = 15
export const EXPERT_START_PREFIX = 'expert_'

const hash = (code: string) => createHash('sha256').update(code).digest('hex')

export async function createExpertLinkCode(userId: string): Promise<{ code: string; deepLink: string | null; expiresAt: Date }> {
  const code = randomBytes(12).toString('base64url')
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000)
  await prisma.$executeRaw`
    INSERT INTO public.telegram_bot_links (bot, user_id, link_code_hash, link_code_expires_at)
    VALUES ('expert', ${userId}::uuid, ${hash(code)}, ${expiresAt})
    ON CONFLICT (bot, user_id) DO UPDATE SET link_code_hash = EXCLUDED.link_code_hash, link_code_expires_at = EXCLUDED.link_code_expires_at`
  return { code, deepLink: deepLink('expert', `${EXPERT_START_PREFIX}${code}`), expiresAt }
}

export async function consumeExpertLinkCode(args: {
  code: string
  telegramUserId: number
  chatId: string
  username?: string | null
}): Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid_or_expired' }> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id::text FROM public.telegram_bot_links
      WHERE bot = 'expert' AND link_code_hash = ${hash(args.code)} AND link_code_expires_at > now()
      FOR UPDATE`
    const row = rows[0]
    if (!row) return { ok: false, reason: 'invalid_or_expired' } as const
    // One Telegram account ↔ one expert.
    await tx.$executeRaw`
      UPDATE public.telegram_bot_links SET telegram_user_id = NULL, chat_id = NULL, linked_at = NULL
      WHERE bot = 'expert' AND telegram_user_id = ${BigInt(args.telegramUserId)} AND user_id <> ${row.user_id}::uuid`
    await tx.$executeRaw`
      UPDATE public.telegram_bot_links
      SET telegram_user_id = ${BigInt(args.telegramUserId)}, chat_id = ${args.chatId}, telegram_username = ${args.username ?? null},
          linked_at = now(), link_code_hash = NULL, link_code_expires_at = NULL
      WHERE bot = 'expert' AND user_id = ${row.user_id}::uuid`
    return { ok: true, userId: row.user_id } as const
  })
}

export interface ExpertPrincipal {
  userId: string
  role: string
  email: string | null
  name: string | null
}

/** The expert behind a Telegram account: linked, approved, expert-bot member (expert portal role or SuperExpert). */
export async function expertByTelegramUser(telegramUserId: number): Promise<ExpertPrincipal | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; role: string; staff_role: string | null; email: string | null; full_name: string | null }>>`
    SELECT l.user_id::text, p.role, s.role AS staff_role, p.email, p.full_name
    FROM public.telegram_bot_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.bot = 'expert' AND l.telegram_user_id = ${BigInt(telegramUserId)} AND l.linked_at IS NOT NULL`
  const r = rows[0]
  if (!r || !isExpertBotMember(r.role, r.staff_role)) return null
  return { userId: r.user_id, role: expertBotRole(r.role, r.staff_role), email: r.email, name: r.full_name }
}

export async function expertLinkStatus(userId: string): Promise<{ linked: boolean; username: string | null; minLevel: string }> {
  const rows = await prisma.$queryRaw<Array<{ linked_at: Date | null; telegram_username: string | null; min_level: string }>>`
    SELECT linked_at, telegram_username, min_level FROM public.telegram_bot_links WHERE bot = 'expert' AND user_id = ${userId}::uuid`
  const r = rows[0]
  return { linked: Boolean(r?.linked_at), username: r?.telegram_username ?? null, minLevel: r?.min_level ?? 'INFO' }
}

export async function unlinkExpertTelegram(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.telegram_bot_links
    SET telegram_user_id = NULL, chat_id = NULL, telegram_username = NULL, linked_at = NULL,
        link_code_hash = NULL, link_code_expires_at = NULL
    WHERE bot = 'expert' AND user_id = ${userId}::uuid`
}
