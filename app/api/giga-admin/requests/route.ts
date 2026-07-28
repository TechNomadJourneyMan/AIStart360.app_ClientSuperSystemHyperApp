export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

function mapStatus(status: string): 'pending' | 'approved' | 'rejected' | 'archived' {
  if (status === 'approved' || status === 'rejected' || status === 'archived') {
    return status
  }
  return 'pending'
}

type JsonRecord = Record<string, unknown>

export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const admin = createServerClient()
    const { data: rows, error } = await admin
      .from('approval_requests')
      .select('id,user_id,company_id,request_type,status,priority,source,payload,rejection_reason,created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    const userIds = [...new Set((rows ?? []).map((row) => row.user_id).filter(Boolean))]
    const companyIds = [...new Set((rows ?? []).map((row) => row.company_id).filter(Boolean))]

    const [profilesResult, companiesResult, progressResult, diagnosticsResult, documentsResult] =
      await Promise.all([
        userIds.length
          ? admin.from('profiles').select('id,full_name,email,avatar_url,role,status').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
        companyIds.length
          ? admin.from('companies').select('id,name,industry,stage').in('id', companyIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length
          ? admin.from('onboarding_progress').select('user_id,current_step,completed_steps,saved_at').in('user_id', userIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length
          ? admin.from('diagnostics').select('user_id,overall_score,calculated_at').in('user_id', userIds).eq('is_current', true)
          : Promise.resolve({ data: [], error: null }),
        userIds.length
          ? admin.from('documents').select('user_id').in('user_id', userIds)
          : Promise.resolve({ data: [], error: null }),
      ])

    for (const result of [profilesResult, companiesResult, progressResult, diagnosticsResult, documentsResult]) {
      if (result.error) throw result.error
    }

    const profiles = new Map((profilesResult.data ?? []).map((row) => [row.id, row]))
    const companies = new Map((companiesResult.data ?? []).map((row) => [row.id, row]))
    const progress = new Map((progressResult.data ?? []).map((row) => [row.user_id, row]))
    const diagnostics = new Map((diagnosticsResult.data ?? []).map((row) => [row.user_id, row]))
    const documentCounts = new Map<string, number>()
    for (const document of documentsResult.data ?? []) {
      documentCounts.set(document.user_id, (documentCounts.get(document.user_id) ?? 0) + 1)
    }

    const requests = (rows ?? []).map((row) => {
      const payload = (row.payload ?? {}) as JsonRecord
      const profile = profiles.get(row.user_id)
      const company = row.company_id ? companies.get(row.company_id) : undefined
      const onboarding = progress.get(row.user_id)
      const diagnostic = diagnostics.get(row.user_id)
      const category = ['registration', 'access', 'support'].includes(row.request_type)
        ? row.request_type
        : 'support'

      return {
        id: row.id,
        category,
        status: mapStatus(row.status),
        userName: profile?.full_name ?? String(payload.name ?? 'Неизвестный'),
        userEmail: profile?.email ?? String(payload.email ?? '—'),
        userAvatar: profile?.avatar_url ?? undefined,
        subject: String(
          payload.subject ??
          (category === 'registration'
            ? `Регистрация ${company?.name ?? payload.company ?? 'компании'}`
            : `Заявка #${row.id.slice(-6)}`),
        ),
        description: String(
          payload.description ??
          payload.message ??
          'Предприниматель запросил доступ к диагностике и Owner-панели.',
        ),
        createdAt: row.created_at,
        company: company?.name ?? (payload.company ? String(payload.company) : undefined),
        companyIndustry: company?.industry ?? undefined,
        companyStage: company?.stage ?? undefined,
        rejectionReason: row.rejection_reason ?? undefined,
        priority: row.priority,
        source: row.source,
        onboardingStep: onboarding?.current_step ?? 1,
        completedSteps: onboarding?.completed_steps ?? [],
        diagnosticScore: diagnostic?.overall_score == null ? null : Number(diagnostic.overall_score),
        diagnosticCalculatedAt: diagnostic?.calculated_at ?? null,
        documentsCount: documentCounts.get(row.user_id) ?? 0,
        profileRole: profile?.role ?? 'client',
        profileStatus: profile?.status ?? 'pending_approval',
      }
    })

    return NextResponse.json({ requests })
  } catch (error) {
    console.error('[giga-admin/requests] GET error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить заявки из Supabase' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json() as {
      userId?: string
      companyId?: string
      type?: 'registration' | 'access' | 'support'
      priority?: 'low' | 'medium' | 'high' | 'critical'
      payload?: JsonRecord
      source?: string
    }

    if (!body.userId) {
      return NextResponse.json({ error: 'userId обязателен' }, { status: 400 })
    }

    const admin = createServerClient()
    const requestType = body.type ?? 'registration'
    const { data, error } = await admin
      .from('approval_requests')
      .upsert(
        {
          user_id: body.userId,
          company_id: body.companyId ?? null,
          request_type: requestType,
          status: 'pending',
          priority: body.priority ?? 'medium',
          payload: body.payload ?? {},
          source: body.source ?? 'giga_panel',
          rejection_reason: null,
          reviewed_at: null,
        },
        { onConflict: 'request_type,user_id' },
      )
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ request: data }, { status: 201 })
  } catch (error) {
    console.error('[giga-admin/requests] POST error:', error)
    return NextResponse.json({ error: 'Не удалось создать заявку' }, { status: 500 })
  }
}
