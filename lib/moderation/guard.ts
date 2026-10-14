/**
 * lib/moderation/guard.ts — серверная проверка текстов перед сохранением.
 *
 *   const rejected = await moderateFields({ userId, email, source: 'profile', req }, [
 *     { field: 'full_name', label: 'Имя', value: body.full_name, kind: 'name' },
 *   ])
 *   if (rejected) return rejected   // 422, текст НЕ сохраняется
 *
 * При нарушении: ответ 422 { ok:false, code:'CONTENT_REJECTED', error, fields },
 * запись в content_moderation_events (мат замаскирован) и уведомление персонала
 * (лента GIGA-CRM + Telegram; не чаще раза в 10 минут на пользователя).
 * Фильтр выключается настройкой content_filter_enabled. Ошибка журнала или
 * уведомления никогда не пропускает текст — решение принимает чистая функция.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getSetting } from '@/lib/settings/store'
import { runInBackground } from '@/lib/background'
import {
  checkProfanity, maskText, maskWord, PROFANITY_CATEGORY_LABELS,
  type ProfanityCategory, type ProfanityDictionary, type ProfanityMatch,
} from './profanity'

export interface ModerationField {
  /** Машинное имя поля, например 'full_name' или 's1_company_name'. */
  field: string
  /** Как поле называется в интерфейсе: «Имя», «Название компании». */
  label: string
  /** Строка, массив или объект — проверяются все строки внутри. */
  value: unknown
  kind?: 'name' | 'text'
}

export interface ModerationContext {
  userId?: string | null
  email?: string | null
  /** Откуда текст: 'register', 'profile', 'company', 'survey', 'goal', … */
  source: string
}

export interface FieldViolation {
  field: string
  label: string
  categories: ProfanityCategory[]
  matches: ProfanityMatch[]
  text: string
}

export const CONTENT_REJECTED = 'CONTENT_REJECTED'

/** Все строки внутри значения (ответ анкеты бывает строкой, массивом или объектом). */
export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || out.length > 500) return out
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out, depth + 1)
  return out
}

// ── словарь из админки (content_filter_terms), кеш 60 с ─────────────────────

let dictCache: { at: number; dict: ProfanityDictionary } | null = null
const DICT_TTL_MS = 60_000

export function invalidateFilterDictionary(): void {
  dictCache = null
}

export async function loadFilterDictionary(opts: { fresh?: boolean } = {}): Promise<ProfanityDictionary> {
  if (!opts.fresh && dictCache && Date.now() - dictCache.at < DICT_TTL_MS) return dictCache.dict
  try {
    const { data, error } = await createServiceClient().from('content_filter_terms').select('term, kind').limit(2000)
    if (error) throw error
    const dict: ProfanityDictionary = {
      block: (data ?? []).filter((r) => r.kind === 'block').map((r) => String(r.term)),
      allow: (data ?? []).filter((r) => r.kind === 'allow').map((r) => String(r.term)),
    }
    dictCache = { at: Date.now(), dict }
    return dict
  } catch {
    // Таблицы ещё нет (миграция 120 не применена) — работают встроенные правила.
    return dictCache?.dict ?? {}
  }
}

async function filterEnabled(): Promise<boolean> {
  try {
    return await getSetting('content_filter_enabled')
  } catch {
    return true
  }
}

/** Проверить поля без побочных эффектов. */
export function findViolations(fields: readonly ModerationField[], dict: ProfanityDictionary): FieldViolation[] {
  const out: FieldViolation[] = []
  for (const f of fields) {
    for (const text of collectStrings(f.value)) {
      const r = checkProfanity(text, { kind: f.kind ?? 'text', dictionary: dict })
      if (!r.clean) {
        out.push({ field: f.field, label: f.label, categories: r.categories, matches: r.matches, text })
        break
      }
    }
  }
  return out
}

export function rejectionMessage(violations: readonly FieldViolation[]): string {
  const labels = [...new Set(violations.map((v) => `«${v.label}»`))].join(', ')
  return violations.length === 1
    ? `Поле ${labels} содержит недопустимые слова (мат, оскорбления или спам). Исправьте текст и сохраните снова.`
    : `Поля ${labels} содержат недопустимые слова (мат, оскорбления или спам). Исправьте текст и сохраните снова.`
}

async function recordAndNotify(ctx: ModerationContext, violations: FieldViolation[]): Promise<void> {
  const svc = createServiceClient()
  const rows = violations.map((v) => ({
    user_id: ctx.userId ?? null,
    user_email: ctx.email ?? null,
    source: ctx.source.slice(0, 60),
    field: v.field.slice(0, 120),
    field_label: v.label.slice(0, 200),
    categories: v.categories,
    terms: [...new Set(v.matches.map((m) => maskWord(m.word)))].slice(0, 20),
    excerpt: maskText(v.text, v.matches),
  }))
  const { error } = await svc.from('content_moderation_events').insert(rows)
  if (error) console.error('[moderation] journal insert failed:', error.message)

  const { notifyStaff } = await import('@/lib/notifications/staff')
  const cats = [...new Set(violations.flatMap((v) => v.categories))].map((c) => PROFANITY_CATEGORY_LABELS[c])
  const who = ctx.email || (ctx.userId ? `id ${ctx.userId.slice(0, 8)}` : 'гость (регистрация)')
  const bucket = Math.floor(Date.now() / 600_000)
  await notifyStaff({
    level: 'WARNING',
    type: 'moderation.content_blocked',
    title: `Фильтр контента: заблокирован текст (${cats.join(', ')})`,
    lines: [
      `Кто: ${who}`,
      `Где: ${ctx.source}`,
      ...violations.slice(0, 5).map((v) => `${v.label}: ${maskText(v.text, v.matches, 120)}`),
    ],
    entityType: 'user',
    entityId: ctx.userId ?? null,
    dedupeKey: `moderation:${ctx.userId ?? ctx.email ?? 'anon'}:${bucket}`,
    link: ctx.userId ? `/admin-giga-panel/content-filter?user=${ctx.userId}` : '/admin-giga-panel/content-filter',
    audiencePermission: 'moderation.content',
  })
}

/**
 * Проверить поля; при нарушении — журнал + уведомление и готовый ответ 422.
 * null — всё чисто (или фильтр выключен), можно сохранять.
 */
export async function moderateFields(ctx: ModerationContext, fields: readonly ModerationField[]): Promise<NextResponse | null> {
  if (!fields.length || !(await filterEnabled())) return null
  const dict = await loadFilterDictionary()
  const violations = findViolations(fields, dict)
  if (!violations.length) return null
  runInBackground('moderation-record', () => recordAndNotify(ctx, violations))
  return NextResponse.json({
    ok: false,
    code: CONTENT_REJECTED,
    error: rejectionMessage(violations),
    fields: violations.map((v) => ({ field: v.field, label: v.label, categories: v.categories })),
  }, { status: 422 })
}
