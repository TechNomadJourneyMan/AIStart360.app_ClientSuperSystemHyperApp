/**
 * lib/crm/contact.ts — what a CONTACT with a client does to the owner's base. One rule for every
 * route that records one, so they cannot drift apart:
 *   • POST /api/v1/crm/clients/[id]/interactions — a call, message or meeting (a note is not);
 *   • PATCH /api/v1/crm/reminders/[id] «Выполнено» — the owner says the planned contact happened.
 *
 * A contact moves last_contact_at («Обработано сегодня» and the queue, lib/crm/today.ts, go by it)
 * and FULFILS every plan of the client due before the end of today's Almaty day that exists at
 * this moment: the open reminders are closed and a next contact planned for today (or missed) is
 * cleared. A call at 11:00 answers the plan for 15:00 made yesterday; a real call-back is planned
 * AFTER the contact (a new reminder, a next contact saved later, or `nextContactAt` given here),
 * so it survives and keeps the client on today's list. Plans for later days are untouched.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { almatyDay } from './today'

export interface ContactInput {
  clientId: string
  userId: string
  /** When the contact happened (epoch ms). */
  nowMs: number
  /** A next contact planned WITH this contact (a call-back): set after the plans are fulfilled. */
  nextContactAt?: string
}

/**
 * Apply a contact. Each write is checked: the first failure stops and is returned, so the route
 * can say the queue was not updated (never a silent success).
 */
export async function applyContact(
  sb: SupabaseClient,
  { clientId, userId, nowMs, nextContactAt }: ContactInput,
): Promise<{ ok: true } | { ok: false; error: { message?: string } }> {
  const now = new Date(nowMs).toISOString()
  const endOfToday = new Date(almatyDay(nowMs).endMs).toISOString()

  const touched = await sb
    .from('crm_clients')
    .update({ last_contact_at: now, updated_at: now })
    .eq('id', clientId)
    .eq('user_id', userId)
  if (touched.error) return { ok: false, error: touched.error }

  const planCleared = await sb
    .from('crm_clients')
    .update({ next_contact_at: null })
    .eq('id', clientId)
    .eq('user_id', userId)
    .lt('next_contact_at', endOfToday)
  if (planCleared.error) return { ok: false, error: planCleared.error }

  const remindersClosed = await sb
    .from('crm_reminders')
    .update({ status: 'done', done_at: now })
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('status', 'open')
    .lt('due_at', endOfToday)
  if (remindersClosed.error) return { ok: false, error: remindersClosed.error }

  if (nextContactAt) {
    const planned = await sb
      .from('crm_clients')
      .update({ next_contact_at: nextContactAt })
      .eq('id', clientId)
      .eq('user_id', userId)
    if (planned.error) return { ok: false, error: planned.error }
  }
  return { ok: true }
}

/** The 500 body when a contact was recorded but the queue was not updated (code queue_not_updated). */
export function queueNotUpdated(message: string) {
  return { ok: false as const, error: 'queue_not_updated', code: 'queue_not_updated', message }
}
