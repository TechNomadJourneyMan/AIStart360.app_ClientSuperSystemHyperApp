/**
 * Binding a Telegram account to a staff user (staff_telegram_links, 087).
 *
 * A staff member asks GIGA for a link; we store only the SHA-256 of a random
 * code with a 15-minute TTL and give back t.me/<bot>?start=staff_<code>.
 * When the bot receives that /start from Telegram, the sender's Telegram user
 * id and chat are bound to the staff account. From then on a button press is
 * attributed to a person, and only people with `approvals.decide` can decide.
 */
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { botUsername } from '@/lib/telegram'

const TTL_MINUTES = 15
export const STAFF_START_PREFIX = 'staff_'

const hash = (code: string) => createHash('sha256').update(code).digest('hex')

export async function createStaffLinkCode(userId: string): Promise<{ code: string; deepLink: string | null; expiresAt: Date }> {
  const code = randomBytes(12).toString('base64url') // 16 chars, start param safe
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000)
  await prisma.$executeRaw`
    INSERT INTO public.staff_telegram_links (user_id, link_code_hash, link_code_expires_at)
    VALUES (${userId}::uuid, ${hash(code)}, ${expiresAt})
    ON CONFLICT (user_id) DO UPDATE SET link_code_hash = EXCLUDED.link_code_hash, link_code_expires_at = EXCLUDED.link_code_expires_at`
  const bot = botUsername()
  return { code, deepLink: bot ? `https://t.me/${bot}?start=${STAFF_START_PREFIX}${code}` : null, expiresAt }
}

export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: 'invalid_or_expired' }

export async function consumeStaffLinkCode(args: {
  code: string
  telegramUserId: number
  chatId: string
  username?: string | null
}): Promise<ConsumeResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id FROM public.staff_telegram_links
      WHERE link_code_hash = ${hash(args.code)} AND link_code_expires_at > now()
      FOR UPDATE`
    const row = rows[0]
    if (!row) return { ok: false, reason: 'invalid_or_expired' } as const
    // One Telegram account ↔ one staff user.
    await tx.$executeRaw`
      UPDATE public.staff_telegram_links
      SET telegram_user_id = NULL, chat_id = NULL, linked_at = NULL
      WHERE telegram_user_id = ${BigInt(args.telegramUserId)} AND user_id <> ${row.user_id}::uuid`
    await tx.$executeRaw`
      UPDATE public.staff_telegram_links
      SET telegram_user_id = ${BigInt(args.telegramUserId)}, chat_id = ${args.chatId},
          telegram_username = ${args.username ?? null}, linked_at = now(),
          link_code_hash = NULL, link_code_expires_at = NULL
      WHERE user_id = ${row.user_id}::uuid`
    return { ok: true, userId: row.user_id } as const
  })
}

export interface LinkedStaff {
  userId: string
  role: StaffRole
  email: string | null
}

/** Staff user behind a Telegram account, if linked, approved and still staff. */
export async function staffByTelegramUser(telegramUserId: number): Promise<LinkedStaff | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; profile_role: string | null; staff_role: string | null; email: string | null }>>`
    SELECT l.user_id, p.role AS profile_role, s.role AS staff_role, p.email
    FROM public.staff_telegram_links l
    JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
    LEFT JOIN public.staff_roles s ON s.user_id = l.user_id
    WHERE l.telegram_user_id = ${BigInt(telegramUserId)} AND l.linked_at IS NOT NULL`
  const r = rows[0]
  if (!r) return null
  const role: StaffRole | null = r.profile_role === 'super_admin' ? 'super_admin' : isStaffRole(r.staff_role) ? r.staff_role : null
  return role ? { userId: r.user_id, role, email: r.email } : null
}

export async function unlinkStaffTelegram(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.staff_telegram_links
    SET telegram_user_id = NULL, chat_id = NULL, telegram_username = NULL, linked_at = NULL,
        link_code_hash = NULL, link_code_expires_at = NULL
    WHERE user_id = ${userId}::uuid`
}
