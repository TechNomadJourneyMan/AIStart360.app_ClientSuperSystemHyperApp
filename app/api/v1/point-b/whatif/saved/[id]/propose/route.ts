export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { recordInbound } from '@/lib/comm/inbound'
import { profanityResponse } from '@/lib/moderation/http'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { authorize, fail, whatIfFailure } from '@/lib/point-b/whatif-http'
import { claimProposal, COMMENT_MAX, getSaved, proposalText, releaseProposal, setProposalMessage } from '@/lib/point-b/whatif-store'

/**
 * POST /api/v1/point-b/whatif/saved/:id/propose { comment? } → { ok, data: { id, proposedAt } }
 * «Предложить эксперту»: the client’s saved scenario goes to the expert as the CLIENT’S OWN message in
 * «Сообщения» («Предлагаю учесть в плане сценарий «<имя>»: <что меняется>. <комментарий>»), the scenario gets
 * `proposedAt`. The plan is NOT changed: the expert decides and edits it himself. If the client has no thread
 * yet, the message creates it; if no expert is assigned, the message still lands in the thread and the staff
 * inbox picks it up.
 * One proposal per scenario: a second call is 409 { code: 'already_proposed' } and sends nothing. 400 — profanity
 * or a comment over 500 characters (`field: 'comment'`); 404 for someone else’s / another company’s / unknown id;
 * 403 «от имени»; 402; 429 (20 proposals per 10 minutes).
 */
const NOT_FOUND = 'Сценарий не найден'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize({ write: true, bucket: 'point-b:whatif-propose', max: 20 })
  if (!auth.ok) return auth.response
  if (!isUuid(params.id)) return fail(NOT_FOUND, 404, { code: 'not_found' })

  const raw = (await req.json().catch(() => null)) as { comment?: unknown } | null
  const rawComment = raw && typeof raw === 'object' ? raw.comment : undefined
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== 'string') return fail('Комментарий должен быть текстом', 400, { code: 'invalid_request', field: 'comment' })
  const bad = profanityResponse({ comment: rawComment })
  if (bad) return bad
  const comment = typeof rawComment === 'string' ? rawComment.trim() : ''
  if (comment.length > COMMENT_MAX) return fail(`Комментарий — не длиннее ${COMMENT_MAX} символов`, 400, { code: 'invalid_request', field: 'comment' })

  const { service, userId } = auth.caller
  let claimedId: string | null = null
  try {
    const company = await companyOfUser(service, userId)
    if (!company) return fail(NOT_FOUND, 404, { code: 'not_found' })
    const saved = await getSaved(service, { id: params.id, companyId: company.id, userId })
    if (!saved) return fail(NOT_FOUND, 404, { code: 'not_found' })
    if (saved.proposed_at) return fail('Этот сценарий уже предложен эксперту', 409, { code: 'already_proposed' })

    // Take the mark first (a conditional update): a repeated or parallel proposal finds it taken and sends nothing.
    const claimed = await claimProposal(service, { id: saved.id, companyId: company.id, userId, at: new Date().toISOString() })
    if (!claimed) return fail('Этот сценарий уже предложен эксперту', 409, { code: 'already_proposed' })
    claimedId = claimed.id

    const res = await recordInbound({
      userId,
      channel: 'app',
      body: proposalText({ name: saved.name, changes: saved.changes, comment: comment || null }),
      metadata: { source: 'point_b_whatif', scenarioId: saved.id },
    }, { sb: service })
    if (res.message?.id) await setProposalMessage(service, saved.id, res.message.id).catch((e) => console.error('[v1/point-b/whatif/propose] message id not stored', e instanceof Error ? e.message : e))
    return NextResponse.json({ ok: true, data: { id: saved.id, proposedAt: claimed.proposed_at } })
  } catch (err) {
    // The message was not sent: give the mark back so the client can try again.
    if (claimedId) await releaseProposal(service, claimedId).catch(() => undefined)
    const answer = whatIfFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/whatif/saved/propose POST]', err instanceof Error ? err.message : err)
    return fail('Не удалось отправить предложение эксперту', 500)
  }
}
