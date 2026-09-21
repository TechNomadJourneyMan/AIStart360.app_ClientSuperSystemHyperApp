export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/duplicates — похоже, это один и тот же клиент.
 *
 * Считаем на сервере из того, что уже есть, без новых таблиц. Три признака:
 *   • одинаковое нормализованное название компании («ТОО Пример» = «пример»);
 *   • одинаковый телефон (только цифры);
 *   • одинаковый email без «плюс-адреса» и точек (ivan.p+test@ = ivanp@).
 *
 * Архивные аккаунты в группы не попадают: они и так выведены из работы.
 */

/** Убираем организационные формы и всё, кроме букв и цифр. */
function normCompany(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    .toLowerCase()
    .replace(/["«»'’`]/g, ' ')
    .replace(/\b(тоо|ип|ао|зао|оао|ооо|llp|llc|ltd|inc|gmbh|компания)\b/g, ' ')
    .replace(/[^a-zа-яё0-9]+/gi, '')
  return cleaned.length >= 3 ? cleaned : null
}

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D+/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

function normEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const [local, domain] = raw.toLowerCase().trim().split('@')
  if (!local || !domain) return null
  const base = local.split('+')[0].replace(/\./g, '')
  return base.length >= 2 ? `${base}@${domain}` : null
}

interface Row {
  id: string; email: string | null; full_name: string | null; organization: string | null
  status: string; created_at: string; company_name?: string | null; phone: string | null
}

const REASONS = { company: 'одинаковая компания', phone: 'одинаковый телефон', email: 'один и тот же адрес' } as const

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response

  const sb = createServiceClient()
  const [{ data: profiles, error }, { data: companies }] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, organization, status, created_at, phone').neq('status', 'archived').limit(5000),
    sb.from('companies').select('user_id, name').limit(5000),
  ])
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить пользователей' }, { status: 500 })

  const companyByUser = new Map<string, string | null>()
  for (const c of (companies ?? []) as Array<{ user_id: string; name: string | null }>) companyByUser.set(c.user_id, c.name)

  const rows = ((profiles ?? []) as Row[]).map((p) => ({ ...p, company_name: companyByUser.get(p.id) ?? null }))

  const buckets = new Map<string, { reason: keyof typeof REASONS; value: string; members: Row[] }>()
  const put = (reason: keyof typeof REASONS, key: string | null, value: string, row: Row) => {
    if (!key) return
    const id = `${reason}:${key}`
    const b = buckets.get(id) ?? { reason, value, members: [] }
    b.members.push(row)
    buckets.set(id, b)
  }

  for (const r of rows) {
    put('company', normCompany(r.company_name ?? r.organization), r.company_name ?? r.organization ?? '', r)
    put('phone', normPhone(r.phone), r.phone ?? '', r)
    put('email', normEmail(r.email), r.email ?? '', r)
  }

  const groups = [...buckets.entries()]
    .filter(([, b]) => b.members.length > 1)
    .map(([id, b]) => ({
      id,
      reason: b.reason,
      reasonLabel: REASONS[b.reason],
      value: b.value,
      count: b.members.length,
      members: b.members
        .sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map((m) => ({
          id: m.id, email: m.email, full_name: m.full_name,
          company: m.company_name ?? m.organization, status: m.status, created_at: m.created_at,
        })),
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    ok: true,
    data: groups,
    scanned: rows.length,
    affected: new Set(groups.flatMap((g) => g.members.map((m) => m.id))).size,
  })
}
