export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { profanityResponse } from '@/lib/moderation/http'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { runWhatIf, validateWhatIf } from '@/lib/point-b/model/whatif'
import { authorize, fail, NO_COMPANY_TEXT, whatIfFailure } from '@/lib/point-b/whatif-http'
import { insertSaved, listSaved, loadWhatIfInputs, NAME_MAX, NOTE_MAX, summaryOf, toView } from '@/lib/point-b/whatif-store'

/**
 * GET /api/v1/point-b/whatif/saved → { ok, data: Array<{ id, name, note, changes, summary, modelVersion, proposedAt, createdAt }> }
 * The owner’s saved «Что если» scenarios, the newest first (at most 20). `summary` is
 * `{ level, delta, baseline, changed, computedAt }`, calculated by the server when the scenario was saved.
 * Reading is allowed «от имени». Pro feature (402). Nobody else’s scenarios are ever returned.
 *
 * POST { name, note?, changes } → { ok, data: <the saved item> }
 * Saves a scenario. The server recalculates the changes and keeps its OWN summary — a `summary` in the body is
 * ignored. 400 { code, field } — `name` (empty, over 80 characters), `note` (over 500), `changes[i].x`, profanity
 * (`code: 'profanity'`), `code: 'no_data'` when there is nothing to calculate (no goal / revenue);
 * 409 { code: 'limit' } at 20 saved scenarios; 403 «от имени»; 402; 429 (30 saves per 10 minutes).
 * The calculation itself writes nothing: this explicit save is the only write of the lab.
 */
export async function GET() {
  const auth = await authorize({ write: false })
  if (!auth.ok) return auth.response
  try {
    const { service, userId } = auth.caller
    const company = await companyOfUser(service, userId)
    if (!company) return NextResponse.json({ ok: true, data: [] })
    const rows = await listSaved(service, { companyId: company.id, userId })
    return NextResponse.json({ ok: true, data: rows.map(toView) })
  } catch (err) {
    const answer = whatIfFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/whatif/saved GET]', err instanceof Error ? err.message : err)
    return fail('Не удалось загрузить сохранённые сценарии', 500)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize({ write: true, bucket: 'point-b:whatif-save', max: 30 })
  if (!auth.ok) return auth.response

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Неверный запрос', 400, { code: 'invalid_request' })
  if (typeof raw.name !== 'string') return fail('Укажите название сценария', 400, { code: 'invalid_request', field: 'name' })
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') return fail('Комментарий должен быть текстом', 400, { code: 'invalid_request', field: 'note' })

  const bad = profanityResponse({ name: raw.name, note: raw.note })
  if (bad) return bad
  const name = raw.name.trim()
  const note = typeof raw.note === 'string' ? raw.note.trim() : ''
  if (!name) return fail('Укажите название сценария', 400, { code: 'invalid_request', field: 'name' })
  if (name.length > NAME_MAX) return fail(`Название — не длиннее ${NAME_MAX} символов`, 400, { code: 'invalid_request', field: 'name' })
  if (note.length > NOTE_MAX) return fail(`Комментарий — не длиннее ${NOTE_MAX} символов`, 400, { code: 'invalid_request', field: 'note' })

  const checked = validateWhatIf(raw.changes)
  if (!checked.ok) return fail(checked.error, 400, { code: 'invalid_request', field: checked.field })
  if (checked.changes.length === 0) return fail('Добавьте хотя бы одно изменение: пустой сценарий сохранять незачем', 400, { code: 'invalid_request', field: 'changes' })

  try {
    const { service, userId } = auth.caller
    const { inputs, companyId } = await loadWhatIfInputs(service, userId)
    if (!companyId) return fail(NO_COMPANY_TEXT, 404, { code: 'no_company' })
    // The summary is the server’s own calculation; whatever the client sent as `summary` was never read.
    const result = runWhatIf(inputs, checked.changes)
    if (result.level === 0) return fail('Для расчёта нужны цель по выручке и текущая выручка: сценарий пока нечем посчитать', 400, { code: 'no_data' })
    const row = await insertSaved(service, {
      companyId, userId, name, note: note || null, changes: checked.changes, summary: summaryOf(result), modelVersion: result.modelVersion,
    })
    return NextResponse.json({ ok: true, data: toView(row) })
  } catch (err) {
    const answer = whatIfFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/whatif/saved POST]', err instanceof Error ? err.message : err)
    return fail('Не удалось сохранить сценарий', 500)
  }
}
