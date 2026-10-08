export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { SURVEY_LABELS } from '@/lib/survey-labels'
import { NO_ID, scopedClientIds } from '@/lib/admin/client-scope'

/**
 * GET /api/giga-admin/surveys/search?q=найм[&key=s2_revenue_2024&min=&max=]
 *
 * Поиск по ОТВЕТАМ, а не по названиям клиентов: «кто жалуется на найм»,
 * «у кого выручка выше 100 млн». Без этого сегментировать под предложение
 * можно было только вручную, открывая анкеты по одной.
 *
 * Текст ищем без учёта регистра по значению ответа; числовой фильтр работает
 * по конкретному вопросу. Оба условия можно комбинировать.
 */

const MAX_MATCHES = 300

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value.replace(/\s| /g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, ['survey.view', 'users.sensitive'])
  if (guard.response) return guard.response

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim().slice(0, 120)
  const key = (sp.get('key') ?? '').trim().slice(0, 80)
  const min = sp.get('min') !== null ? Number(sp.get('min')) : null
  const max = sp.get('max') !== null ? Number(sp.get('max')) : null
  if (!q && !key) return NextResponse.json({ ok: false, error: 'Укажите текст или вопрос' }, { status: 400 })
  if (key && !/^[a-z][a-z0-9_]{1,79}$/.test(key)) return NextResponse.json({ ok: false, error: 'Неверный ключ вопроса' }, { status: 400 })

  const sb = createServiceClient()
  let query = sb.from('survey_answers').select('user_id, question_key, answer').limit(20000)
  if (key) query = query.eq('question_key', key)
  const allowed = await scopedClientIds(guard.actor)
  if (allowed) query = query.in('user_id', allowed.length ? allowed : [NO_ID])
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось выполнить поиск' }, { status: 500 })

  const needle = q.toLowerCase()
  const hits = new Map<string, Array<{ key: string; label: string; value: string }>>()

  for (const row of (data ?? []) as Array<{ user_id: string; question_key: string; answer: { value?: unknown } | null }>) {
    if (!isWizardVisibleKey(row.question_key)) continue
    const value = row.answer?.value
    const text = asText(value)
    if (!text) continue

    if (q && !text.toLowerCase().includes(needle)) continue
    if (min !== null || max !== null) {
      const n = asNumber(value)
      if (n === null) continue
      if (min !== null && Number.isFinite(min) && n < min) continue
      if (max !== null && Number.isFinite(max) && n > max) continue
    }

    const list = hits.get(row.user_id) ?? []
    if (list.length < 5) {
      list.push({ key: row.question_key, label: SURVEY_LABELS[row.question_key] ?? row.question_key, value: text.slice(0, 200) })
    }
    hits.set(row.user_id, list)
  }

  const ids = [...hits.keys()].slice(0, MAX_MATCHES)
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, full_name, email, organization').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null; organization: string | null }> }
  const { data: companies } = ids.length
    ? await sb.from('companies').select('user_id, name').in('user_id', ids)
    : { data: [] as Array<{ user_id: string; name: string | null }> }
  const companyByUser = new Map((companies ?? []).map((c) => [c.user_id, c.name]))

  const results = (people ?? []).map((p) => ({
    id: p.id,
    name: companyByUser.get(p.id) || p.organization || p.full_name || p.email || p.id,
    email: p.email,
    matches: hits.get(p.id) ?? [],
  }))

  return NextResponse.json({ ok: true, data: results, total: hits.size, truncated: hits.size > MAX_MATCHES })
}
