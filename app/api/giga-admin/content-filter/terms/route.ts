export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { invalidateFilterDictionary } from '@/lib/moderation/guard'
import { FILTER_TERM_KINDS, isMissingTable, migrationMissingResponse, UUID_RE } from '@/lib/moderation/admin'

/**
 * Словарь фильтра контента (content_filter_terms).
 *   GET                         — все слова
 *   POST   { term, kind, note? } — добавить: block — запретить (совпадение с началом
 *                                 слова), allow — исключение для ложного срабатывания
 *   DELETE { id } (или ?id=)     — удалить
 * Право moderation.content; изменения пишутся в журнал администратора и
 * сбрасывают кеш словаря (lib/moderation/guard.ts, 60 с на инстанс).
 */
const createSchema = z.object({
  term: z.string().trim().min(2, 'Слово — от 2 до 60 символов').max(60, 'Слово — от 2 до 60 символов')
    .refine((t) => !/\s{2,}/.test(t), 'Уберите лишние пробелы'),
  kind: z.enum(FILTER_TERM_KINDS),
  note: z.string().trim().max(300).optional().nullable(),
})

const deleteSchema = z.object({ id: z.string().regex(UUID_RE) })

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response
  const { data, error } = await createServiceClient()
    .from('content_filter_terms')
    .select('id, term, kind, note, created_by, created_at')
    .order('kind', { ascending: true })
    .order('term', { ascending: true })
    .limit(2000)
  if (error) {
    if (isMissingTable(error)) return migrationMissingResponse()
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить словарь' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response
  const actor = guard.actor

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const term = parsed.data.term.toLowerCase().replace(/ё/g, 'е')
  const { kind } = parsed.data
  const note = parsed.data.note || null

  const { data, error } = await createServiceClient()
    .from('content_filter_terms')
    .insert({ term, kind, note, created_by: UUID_RE.test(actor.id) ? actor.id : null })
    .select('id, term, kind, note, created_by, created_at')
    .single()
  if (error) {
    if (isMissingTable(error)) return migrationMissingResponse()
    if (error.code === '23505') {
      return NextResponse.json({ ok: false, error: kind === 'allow' ? 'Это слово уже в исключениях' : 'Это слово уже в списке запрещённых' }, { status: 409 })
    }
    console.error('[giga-admin/content-filter/terms] insert failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Не удалось добавить слово' }, { status: 500 })
  }
  invalidateFilterDictionary()

  await recordAdminAction(actor, {
    action: 'moderation.term_added',
    entityType: 'content_filter_term',
    entityId: data.id,
    newValue: { term, kind, note },
  }, req)

  return NextResponse.json({ ok: true, data }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response
  const actor = guard.actor

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const parsed = deleteSchema.safeParse({ id: body?.id ?? req.nextUrl.searchParams.get('id') })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Слово не найдено' }, { status: 404 })

  const { data, error } = await createServiceClient()
    .from('content_filter_terms')
    .delete()
    .eq('id', parsed.data.id)
    .select('id, term, kind, note')
  if (error) {
    if (isMissingTable(error)) return migrationMissingResponse()
    return NextResponse.json({ ok: false, error: 'Не удалось удалить слово' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ ok: false, error: 'Слово не найдено' }, { status: 404 })
  invalidateFilterDictionary()

  await recordAdminAction(actor, {
    action: 'moderation.term_removed',
    entityType: 'content_filter_term',
    entityId: parsed.data.id,
    oldValue: data[0],
  }, req)

  return NextResponse.json({ ok: true, data: { id: parsed.data.id } })
}
