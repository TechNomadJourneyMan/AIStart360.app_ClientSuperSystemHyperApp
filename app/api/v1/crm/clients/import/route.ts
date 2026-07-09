export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseClientsCsv } from '@/lib/crm/csv-import'
import { parseDocument, detectDocumentType } from '@/lib/documents/parse'

const MAX_ROWS = 2000
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 МБ — с запасом на 2000 строк CSV/XLSX
const CHUNK = 200 // размер батча для .in()-поиска и массовых вставок

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

  let inserted = 0
  let updated = 0
  let skipped = parseSkipped

  // Какие из телефонов уже есть у пользователя → карта phone -> id.
  // Поиск чанками, чтобы не упереться в лимит длины URL у .in().
  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p)
  const existing = new Map<string, string>()
  for (let i = 0; i < phones.length; i += CHUNK) {
    const slice = phones.slice(i, i + CHUNK)
    const { data: existRows, error: lookupErr } = await sb
      .from('crm_clients')
      .select('id, phone')
      .eq('user_id', userId)
      .in('phone', slice)
    // Проглотить ошибку нельзя: иначе existing пуст → всё уходит в insert →
    // ловит уникальный индекс → тихо «импортировалось почти ничего».
    if (lookupErr) {
      return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
    }
    for (const e of existRows ?? []) {
      if (e.phone) existing.set(e.phone as string, e.id as string)
    }
  }

  // Разделяем на массовую вставку (обычно большинство) и точечные апдейты.
  const toInsert = rows.filter((r) => !(r.phone && existing.has(r.phone)))
  const toUpdate = rows.filter((r) => r.phone && existing.has(r.phone))

  // Массовые вставки чанками: ceil(N/CHUNK) запросов вместо N.
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from('crm_clients')
      .insert(
        slice.map((row) => ({
          user_id: userId,
          name: row.name,
          phone: row.phone,
          phone_raw: row.phone_raw,
          email: row.email,
          note: row.note,
          avg_check: row.avg_check,
          source: 'csv',
        })),
      )
      .select('id')
    if (error) {
      // Дедуп в parseClientsCsv делает конфликты маловероятными; при ошибке чанка
      // (напр. гонка 23505) считаем строки пропущенными, но не валим весь импорт.
      skipped += slice.length
    } else {
      inserted += data?.length ?? slice.length
    }
  }

  // Апдейты — по одному (у каждой строки свои данные); их обычно немного (пересечение).
  for (const row of toUpdate) {
    const existingId = existing.get(row.phone as string)!
    const { data, error } = await sb
      .from('crm_clients')
      .update({
        name: row.name,
        phone_raw: row.phone_raw,
        email: row.email,
        note: row.note,
        avg_check: row.avg_check,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingId)
      .eq('user_id', userId)
      .select('id')
    if (error || !data || data.length === 0) skipped++
    else updated++
  }

  return NextResponse.json({ ok: true, data: { inserted, updated, skipped } })
}
