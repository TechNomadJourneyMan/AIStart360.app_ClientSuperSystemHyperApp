export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseClientsCsv } from '@/lib/crm/csv-import'
import { parseDocument, detectDocumentType } from '@/lib/documents/parse'

const MAX_ROWS = 2000

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

  // Батч-запрос: какие из телефонов уже есть у пользователя → карта phone -> id.
  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p)
  const existing = new Map<string, string>()
  if (phones.length > 0) {
    const { data: existRows } = await sb
      .from('crm_clients')
      .select('id, phone')
      .eq('user_id', userId)
      .in('phone', phones)
    for (const e of existRows ?? []) {
      if (e.phone) existing.set(e.phone as string, e.id as string)
    }
  }

  for (const row of rows) {
    const existingId = row.phone ? existing.get(row.phone) : undefined
    if (existingId) {
      // Обновляем существующего (по телефону) — не трогаем статус/источник.
      const { error } = await sb
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
      if (error) skipped++
      else updated++
    } else {
      const { error } = await sb.from('crm_clients').insert({
        user_id: userId,
        name: row.name,
        phone: row.phone,
        phone_raw: row.phone_raw,
        email: row.email,
        note: row.note,
        avg_check: row.avg_check,
        source: 'csv',
      })
      // parseClientsCsv уже дедупит телефоны внутри файла, поэтому конфликтов
      // здесь не ждём; 23505 (гонка) считаем skipped, а не падаем.
      if (error) skipped++
      else inserted++
    }
  }

  return NextResponse.json({ ok: true, data: { inserted, updated, skipped } })
}
