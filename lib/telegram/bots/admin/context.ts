/**
 * Admin bot principal: a staff member linked through the GIGA staff link
 * (staff_telegram_links, 087), re-read on every update — revoking a role,
 * blocking or unlinking takes effect on the next button press.
 */
import { hasPermission, PERMISSIONS, type Permission, type StaffRole } from '@/lib/admin/rbac'
import type { AuditEntry } from '@/lib/admin/audit'
import type { AuditWriter } from '@/lib/admin/staff-actions'
import { staffByTelegramUser } from '@/lib/telegram/staff-link'
import type { BotContext, Entry, StepEntry } from '../dispatcher'

export interface StaffPrincipal {
  userId: string
  role: StaffRole
  email: string | null
}

export type AdminCtx = BotContext<StaffPrincipal>
export type AdminEntry = Entry<StaffPrincipal> & { perm?: Permission | Permission[] }
export type AdminStep = StepEntry<StaffPrincipal> & { perm?: Permission | Permission[] }

export async function resolveStaff(telegramUserId: number): Promise<StaffPrincipal | null> {
  const s = await staffByTelegramUser(telegramUserId)
  return s ? { userId: s.userId, role: s.role, email: s.email } : null
}

export function can(ctx: AdminCtx, perm: Permission): boolean {
  return hasPermission(ctx.principal.role, perm)
}

export function permLabel(perm: string): string {
  return (PERMISSIONS as Record<string, string>)[perm] ?? perm
}

/** Audit writer bound to the staff member acting through the bot. */
export function auditFor(ctx: AdminCtx): AuditWriter {
  const actor = { id: ctx.principal.userId, kind: 'telegram' as const, role: ctx.principal.role, email: ctx.principal.email ?? undefined }
  return (entry: AuditEntry, opts?: { required?: boolean }) =>
    ctx.deps.audit(actor, { ...entry, metadata: { ...(entry.metadata ?? {}), via: 'telegram' } }, opts)
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
