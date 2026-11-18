export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseClientsCsv } from '@/lib/crm/csv-import'
import { parseDocument, detectDocumentType } from '@/lib/documents/parse'
import { planImport, type ClientFields, type ExistingClient } from '@/lib/crm/import-merge'
import { PAGE_SIZE, readAllById } from '@/lib/crm/today'

const MAX_ROWS = 2000
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 МБ — с запасом на 2000 строк CSV/XLSX
const CHUNK = 200 // размер батча массовых вставок

/**
 * POST /api/v1/crm/clients/import — CSV / XLSX into the owner's base.
 *
 * Rows are matched to the base by phone, else by e-mail, else (no phone, no e-mail) an identical
 * anonymous row; a match is updated with the row's non-empty values only — an empty cell never
 * wipes a field. Re-importing the same file creates nothing and changes nothing. Rules:
 * lib/crm/import-merge.ts.
 *
 * Answer: { inserted, updated, unchanged, duplicates (rows repeating a contact of the same file),
 * skipped (nameless rows and rows the DB refused) }.
 */
export async function POST(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'expected multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file field required' }, { status: 400 })
  }
  // Ограничиваем размер ДО чтения в память (иначе большой файл материализуется
  // целиком ещё до проверки MAX_ROWS).
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, error: 'Файл больше 5 МБ' }, { status: 413 })
  }

  // Достаём текст: CSV → напрямую, XLSX → через parseDocument (снимаем маркеры листов).
  const docType = detectDocumentType(file.name, file.type)
  let text: string
  try {
    if (docType === 'xlsx') {
      const buf = Buffer.from(await file.arrayBuffer())
      const parsed = await parseDocument(buf, file.name, file.type)
      text = parsed.text
        .split('\n')
        .filter((l) => !l.startsWith('[Sheet:'))
        .join('\n')
    } else {
      text = await file.text()
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'could not read file' }, { status: 400 })
  }

  const { rows, skipped: parseSkipped } = parseClientsCsv(text)
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: 'too many rows' }, { status: 413 })
  }

  // The owner's whole base (page by page — no silent cut), matched in memory.
  const base = await readAllById<ExistingClient>((after) => {
    let q = sb
      .from('crm_clients')
      .select('id, name, phone, phone_raw, email, note, avg_check, created_at')
      .eq('user_id', userId)
    if (after) q = q.gt('id', after)
    return q.order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<{
      data: ExistingClient[] | null
      error: unknown
    }>
  })
  // A failed read must not be swallowed: every row would then become a second copy of a client.
  if (!base.ok) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  const plan = planImport(rows, base.rows)
  let inserted = 0
  let updated = 0
  let skipped = parseSkipped

  // Inserts in chunks: ceil(N/CHUNK) requests instead of N.
  const insertRow = (f: ClientFields) => ({ ...f, user_id: userId, source: 'csv' })
  for (let i = 0; i < plan.inserts.length; i += CHUNK) {
    const slice = plan.inserts.slice(i, i + CHUNK)
    const { data, error } = await sb.from('crm_clients').insert(slice.map(insertRow)).select('id')
    if (!error) {
      inserted += data?.length ?? slice.length
      continue
    }
    // A chunk refused (e.g. a phone added meanwhile — 23505): retry its rows one by one, so one
    // conflict does not drop the other rows of the chunk.
    for (const f of slice) {
      const one = await sb.from('crm_clients').insert(insertRow(f)).select('id')
      if (one.error || !one.data || one.data.length === 0) skipped++
      else inserted++
    }
  }

  // Updates only where the file changes something (re-importing the same file writes nothing).
  for (const u of plan.updates) {
    const { data, error } = await sb
      .from('crm_clients')
      .update({ ...u.fields, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .eq('user_id', userId)
      .select('id')
    if (error || !data || data.length === 0) skipped++
    else updated++
  }

  return NextResponse.json({
    ok: true,
    data: { inserted, updated, unchanged: plan.unchanged, duplicates: plan.duplicates, skipped },
  })
}
