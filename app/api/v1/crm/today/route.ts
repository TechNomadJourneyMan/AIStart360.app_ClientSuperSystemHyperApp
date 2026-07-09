export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { scoreClientRisk } from '@/lib/crm/risk'
import type { ClientStatus } from '@/lib/crm/client-validate'

// Форма ответа совместима с текущим usePulse-контрактом
// { stats, todayClients, aiBriefing } — чтобы переиспользовать существующий фронт.

const ACTIVE_STATUSES: ClientStatus[] = ['new', 'in_progress', 'waiting']
const SLEEPING_STATUSES: ClientStatus[] = ['customer', 'sleeping']
const SLEEPING_DAYS = 30

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  customer: 'Клиент',
  sleeping: 'Спящий',
  lost: 'Потерян',
}

interface ClientRow {
  id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  status: string
  avg_check: number | null
  note: string | null
  next_contact_at: string | null
  last_contact_at: string | null
  created_at: string
}

function fmtRu(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
}

export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  const { data: clientsData, error: clientsErr } = await sb
    .from('crm_clients')
    .select(
      'id, name, phone, phone_raw, email, status, avg_check, note, next_contact_at, last_contact_at, created_at',
    )
    .eq('user_id', userId)
    .limit(500)
  if (clientsErr) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  const clients = (clientsData ?? []) as ClientRow[]

  // Открытые напоминания → карта client_id -> самый ранний due.
  const { data: remData } = await sb
    .from('crm_reminders')
    .select('client_id, due_at')
    .eq('user_id', userId)
    .eq('status', 'open')
  const earliestDue = new Map<string, number>()
  for (const r of remData ?? []) {
    const t = new Date(r.due_at as string).getTime()
    if (Number.isNaN(t)) continue
    const prev = earliestDue.get(r.client_id as string)
    if (prev === undefined || t < prev) earliestDue.set(r.client_id as string, t)
  }

  const now = new Date()
  const nowMs = now.getTime()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startMs = startOfToday.getTime()
  const endMs = startMs + 86_400_000

  // Портфельный средний чек (по клиентам с положительным чеком).
  const withCheck = clients.filter((c) => typeof c.avg_check === 'number' && (c.avg_check ?? 0) > 0)
  const portfolioAvg =
    withCheck.length > 0
      ? withCheck.reduce((s, c) => s + (c.avg_check ?? 0), 0) / withCheck.length
      : 0

  // Скоринг всех клиентов (для KPI) + определение очереди «сегодня».
  const scored = clients.map((c) => {
    const risk = scoreClientRisk(
      { lastContactAt: c.last_contact_at, avgCheck: c.avg_check, status: c.status, now: nowMs },
      portfolioAvg,
    )

    // Приоритетный «бакет» очереди (меньше = выше).
    let bucket: number | null = null
    const setBucket = (b: number) => {
      bucket = bucket == null ? b : Math.min(bucket, b)
    }

    const dueMs = earliestDue.get(c.id)
    if (dueMs !== undefined) {
      if (dueMs < startMs) setBucket(0)
      else if (dueMs < endMs) setBucket(1)
    }
    if (c.next_contact_at) {
      const nc = new Date(c.next_contact_at).getTime()
      if (!Number.isNaN(nc)) {
        if (nc < startMs) setBucket(0)
        else if (nc < endMs) setBucket(1)
      }
    }
    if (bucket == null && !c.next_contact_at && ACTIVE_STATUSES.includes(c.status as ClientStatus)) {
      setBucket(2)
    }
    if (
      bucket == null &&
      risk.daysSince != null &&
      risk.daysSince > SLEEPING_DAYS &&
      SLEEPING_STATUSES.includes(c.status as ClientStatus)
    ) {
      setBucket(3)
    }

    return { c, risk, bucket }
  })

  // KPI (по всему портфелю own).
  const highRisk = scored.filter((s) => s.risk.churnLevel === 'high')
  const mediumRisk = scored.filter((s) => s.risk.churnLevel === 'medium')
  const revenueAtRisk = highRisk.reduce((s, x) => s + (x.c.avg_check ?? 0), 0)
  const processedToday = clients.filter((c) => {
    if (!c.last_contact_at) return false
    const t = new Date(c.last_contact_at).getTime()
    return !Number.isNaN(t) && t >= startMs && t < endMs
  }).length

  const stats = {
    revenueAtRisk,
    highRisk: highRisk.length,
    mediumRisk: mediumRisk.length,
    totalClients: clients.length,
    processedToday,
    dailyTarget: 6,
  }

  // Очередь «Кому звонить сегодня» — только клиенты с bucket, сорт: bucket, риск.
  const todayClients = scored
    .filter((s) => s.bucket != null)
    .sort((a, b) => (a.bucket! - b.bucket!) || (b.risk.riskScore - a.risk.riskScore))
    .map(({ c, risk, bucket }) => ({
      id: c.id,
      name: c.name,
      sector: STATUS_LABELS[c.status] ?? c.status,
      forbes: null,
      lastOrder: fmtRu(c.last_contact_at),
      daysSince: risk.daysSince ?? 999,
      avgCheck: c.avg_check ?? 0,
      volumeChange: risk.volumeChange,
      riskScore: risk.riskScore,
      churnProb: risk.churnProb,
      churnLevel: risk.churnLevel,
      comment: risk.comment,
      action: risk.action,
      history: risk.history,
      orderCycle: 30,
      // Нативные CRM-поля (для нового useCrm/drawer; лишнее старый фронт игнорирует).
      status: c.status,
      phone: c.phone,
      phoneRaw: c.phone_raw,
      email: c.email,
      note: c.note,
      nextContactAt: c.next_contact_at,
      lastContactAt: c.last_contact_at,
      queueBucket: bucket,
    }))

  return NextResponse.json({ stats, todayClients, aiBriefing: null })
}
