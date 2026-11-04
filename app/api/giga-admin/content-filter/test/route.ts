export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { findViolations, loadFilterDictionary } from '@/lib/moderation/guard'
import { maskText, PROFANITY_CATEGORY_LABELS } from '@/lib/moderation/profanity'
import { getSetting } from '@/lib/settings/store'

/**
 * POST /api/giga-admin/content-filter/test { text, kind? }
 *
 * «Проверка текста» в админке: тот же разбор, что делает сервер при
 * сохранении (встроенные правила + свежий словарь из content_filter_terms),
 * без записи в журнал и без уведомлений. Право moderation.content.
 */
const bodySchema = z.object({
  text: z.string().max(5000, 'Не длиннее 5000 символов'),
  kind: z.enum(['name', 'text']).optional().default('text'),
})

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const { text, kind } = parsed.data

  const dict = await loadFilterDictionary({ fresh: true })
  let filterEnabled = true
  try {
    filterEnabled = await getSetting('content_filter_enabled', { fresh: true })
  } catch {
    // fail-safe: guard.ts считает фильтр включённым
  }

  const [violation] = findViolations([{ field: 'text', label: 'Текст', value: text, kind }], dict)
  const matches = violation?.matches ?? []
  return NextResponse.json({
    ok: true,
    data: {
      clean: matches.length === 0,
      kind,
      filterEnabled,
      matches: matches.map((m) => ({ word: m.word, category: m.category, label: PROFANITY_CATEGORY_LABELS[m.category] })),
      categories: violation?.categories ?? [],
      masked: matches.length ? maskText(text, matches, 5000) : text,
      dictionary: { block: dict.block?.length ?? 0, allow: dict.allow?.length ?? 0 },
    },
  })
}
