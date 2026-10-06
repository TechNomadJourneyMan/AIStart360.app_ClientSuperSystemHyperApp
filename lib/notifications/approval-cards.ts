/**
 * After an approval is decided (in GIGA or in Telegram), every Telegram card
 * that offered the buttons is edited to show the outcome — no stale buttons,
 * and other approvers see who decided.
 */
import { prisma } from '@/lib/db'
import { editBotMessage, tgEscape } from '@/lib/telegram/bot-api'
import { botToken, staffBot } from '@/lib/telegram/bots/registry'

export async function closeApprovalCards(args: {
  approvalId: string
  status: 'approved' | 'rejected' | 'expired'
  decidedBy: string | null
  via: 'admin' | 'telegram' | 'system'
  summary?: string | null
  fetchImpl?: typeof fetch
}): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ target: string; provider_message_id: string }>>`
    SELECT d.target, d.provider_message_id
    FROM public.notification_deliveries d
    JOIN public.notification_events e ON e.id = d.event_id
    WHERE e.approval_id = ${args.approvalId}::uuid AND d.channel = 'telegram'
      AND d.status = 'sent' AND d.provider_message_id IS NOT NULL`
  const verdict = args.status === 'approved' ? '✅ Одобрено' : args.status === 'rejected' ? '❌ Отклонено' : '⌛ Истекло'
  const who = args.decidedBy ? ` — ${tgEscape(args.decidedBy)}` : ''
  const where = args.via === 'telegram' ? ' (Telegram)' : args.via === 'admin' ? ' (панель GIGA)' : ''
  const text = `<b>[AIStart360]</b> ${verdict}${who}${where}\n\n${tgEscape(args.summary ?? 'Действие агента')}`
  // Cards are sent by the staff bot; a card sent before the admin bot was
  // configured lives in the client bot — try that one when the edit fails.
  const primary = staffBot()
  const fallback = primary === 'admin' && botToken('client') ? 'client' as const : null
  let edited = 0
  for (const r of rows) {
    const id = Number(r.provider_message_id)
    if (!Number.isFinite(id)) continue
    let res = await editBotMessage(r.target, id, text, args.fetchImpl, primary)
    if (!res.ok && fallback && !/not modified/i.test(res.description)) res = await editBotMessage(r.target, id, text, args.fetchImpl, fallback)
    if (res.ok) edited += 1
  }
  return edited
}
