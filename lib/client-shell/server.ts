/**
 * lib/client-shell/server.ts — what the client cabinet shell needs, read on the
 * server for the session user (app/client/layout.tsx).
 *
 * Cheap on purpose (it runs on every cabinet page):
 *  - role / status come from the user facts that the section filter has
 *    already read in this render (getRequestUserFacts is memoised);
 *  - staff_roles is read only when the facts say the account is staff;
 *  - the unread counter is one indexed row (comm_threads.user_id is unique),
 *    read through the session client — RLS lets the owner read it;
 *  - the bell (R-096) is one indexed count of the own unread notifications
 *    (app_notifications_user_idx), also through the session client.
 * Any failure degrades to "no badge / no panel button", never to an error.
 */
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRequestUserFacts } from '@/lib/platform/facts'
import { getRequestAccess } from '@/lib/access/request-access'
import {
  buildClientMoreNav,
  buildClientNav,
  clientNotificationsLink,
  lockedNavKeysFor,
  usesClientShell,
  type ClientMoreItem,
  type ClientNavItem,
  type ClientNavKey,
  type ClientNotificationsLink,
} from './nav'
import { expertCabinetLink, staffPanelLink, type CabinetLink, type PanelLink, type ViewerRoles } from './staff-links'

export interface ClientShellData {
  items: ClientNavItem[]
  /** «Вернуться в панель» — only for staff (server-checked role). */
  panel: PanelLink | null
  /** Shown in the profile menu. */
  email: string | null
  /** R-096: the bell (feed link + unread count), null when the feed is not for this account. */
  notifications: ClientNotificationsLink | null
  /** WA-1: «Ещё» — the other sections visible to the account (may be empty). */
  more: ClientMoreItem[]
}

async function staffRoleOf(userId: string): Promise<string | null> {
  try {
    const { data } = await createServiceClient().from('staff_roles').select('role').eq('user_id', userId).maybeSingle()
    return (data as { role?: string } | null)?.role ?? null
  } catch {
    return null
  }
}

/** R-096: unread entries of the own notification feed (the bell). */
async function unreadNotifications(userId: string): Promise<number> {
  try {
    const { count } = await createServerClient()
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('archived_at', null)
    return Number(count ?? 0) || 0
  } catch {
    return 0
  }
}

async function unreadMessages(userId: string): Promise<number> {
  try {
    const { data } = await createServerClient().from('comm_threads').select('unread_user').eq('user_id', userId).maybeSingle()
    return Number((data as { unread_user?: number } | null)?.unread_user ?? 0) || 0
  } catch {
    return 0
  }
}

export interface ClientShellAccount {
  approved: boolean
  profileRole: string | null
  unreadMessages: number
  /** R-096: unread notifications (the bell). */
  unreadNotifications: number
  panel: PanelLink | null
  email: string | null
}

/**
 * profiles.role / status and staff_roles.role of the session user, or null
 * when they cannot be read. staff_roles is read only for staff accounts.
 */
export async function loadViewerRoles(userId: string): Promise<ViewerRoles | null> {
  const facts = await getRequestUserFacts(userId).catch(() => null)
  if (!facts) return null
  const staffRole = facts.is_staff ? await staffRoleOf(userId) : null
  return { profileRole: facts.role, staffRole, status: facts.status }
}

/** The per-user part (runs in parallel with the section filter in the layout). */
export async function loadClientShellAccount(user: Pick<User, 'id' | 'email'> | null): Promise<ClientShellAccount> {
  if (!user) return { approved: false, profileRole: null, unreadMessages: 0, unreadNotifications: 0, panel: null, email: null }
  const [roles, unread, notifications] = await Promise.all([loadViewerRoles(user.id), unreadMessages(user.id), unreadNotifications(user.id)])
  return {
    // Unknown roles (a database hiccup) fail open for the menu only: every
    // route still checks access on its own (middleware + page).
    approved: roles ? roles.status === 'approved' : true,
    profileRole: roles?.profileRole ?? null,
    unreadMessages: unread,
    unreadNotifications: notifications,
    panel: roles ? staffPanelLink(roles) : null,
    email: user.email ?? null,
  }
}

/** «Открыть кабинет клиента (проверка)» for the expert portal header. */
export async function loadExpertCabinetLink(user: Pick<User, 'id'> | null): Promise<CabinetLink | null> {
  if (!user) return null
  const roles = await loadViewerRoles(user.id)
  return roles ? expertCabinetLink(roles) : null
}

/**
 * Menu items for the account, minus the sections hidden in GIGA-CRM; paid
 * sections closed for it (`lockedKeys`, Round 2) carry a lock.
 */
export function clientShellData(account: ClientShellAccount, hiddenPaths: readonly string[], lockedKeys: readonly ClientNavKey[] = []): ClientShellData {
  return {
    items: buildClientNav({ approved: account.approved, hiddenPaths, profileRole: account.profileRole, unreadMessages: account.unreadMessages, lockedKeys }),
    panel: account.panel,
    email: account.email,
    notifications: clientNotificationsLink({ profileRole: account.profileRole, hiddenPaths, unread: account.unreadNotifications }),
    more: buildClientMoreNav({ approved: account.approved, hiddenPaths, profileRole: account.profileRole }),
  }
}

/** Round 2 (R2-A): menu items of the paid sections closed for the user (one server decision per render). */
export async function lockedClientNavKeys(userId: string): Promise<ClientNavKey[]> {
  try {
    return lockedNavKeysFor((await getRequestAccess(userId)).sections)
  } catch {
    return [] // the pages and the API still gate on their own
  }
}

/**
 * R-028 (quick step): the pages of the old (dashboard) shell that clients use
 * (/dashboard, /gri, /settings, /notifications…) draw the SAME cabinet bar as
 * /client/* for a client — home, survey, messages, documents included, on the
 * phone too — instead of the staff sidebar and its bottom bar. Staff, experts
 * and unknown facts get null: the old shell, as before.
 */
export async function loadDashboardClientShell(
  user: Pick<User, 'id' | 'email'> | null,
): Promise<{ account: ClientShellAccount; lockedKeys: ClientNavKey[] } | null> {
  if (!user) return null
  const facts = await getRequestUserFacts(user.id).catch(() => null)
  if (!usesClientShell(facts)) return null
  const [account, lockedKeys] = await Promise.all([loadClientShellAccount(user), lockedClientNavKeys(user.id)])
  return { account, lockedKeys }
}
