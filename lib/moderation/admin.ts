/**
 * lib/moderation/admin.ts — общее для API страницы «Фильтр контента»
 * (/api/giga-admin/content-filter/**).
 */
import { NextResponse } from 'next/server'

export const MODERATION_EVENT_STATUSES = ['open', 'reviewed', 'false_positive'] as const
export type ModerationEventStatus = (typeof MODERATION_EVENT_STATUSES)[number]

export const FILTER_TERM_KINDS = ['block', 'allow'] as const
export type FilterTermKind = (typeof FILTER_TERM_KINDS)[number]

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Таблица ещё не создана (миграция не применена): Postgres 42P01 / PostgREST PGRST205. */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '')
}

export const MIGRATION_MISSING_MESSAGE =
  'Таблицы фильтра контента не созданы — миграция 120 (supabase/migrations/120_content_filter_devtools.sql) не применена. ' +
  'Фильтр уже работает по встроенным правилам, но журнал и словарь появятся после применения миграции.'

export function migrationMissingResponse(): NextResponse {
  return NextResponse.json({ ok: false, code: 'MIGRATION_MISSING', error: MIGRATION_MISSING_MESSAGE }, { status: 503 })
}
