import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, isStaffRole } from '@/lib/api-utils'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Authorization model for a single client record:
//   - caller must be authenticated staff (not a self-serve CLIENT), AND
//   - the client must belong to the caller's organization (orgId match).
// We return 404 (not 403) for both "missing" and "not authorized" so another
// tenant's client ids cannot be probed via enumeration.
function authCtx(session: any) {
  return {
    role: session?.user?.role as string | undefined,
    orgId: session?.user?.orgId as string | undefined,
  }
}

function mayAccess(clientOrgId: string | null | undefined, role?: string, orgId?: string): boolean {
  return isStaffRole(role) && !!orgId && clientOrgId === orgId
}

// PATCH field whitelist — prevents mass-assignment of orgId / managerId / ids /
// timestamps (previously the entire request body was written verbatim).
const updateSchema = z
  .object({
    name: z.string().min(2),
    industry: z.string().min(1),
    stage: z.enum(['Seed', 'Early', 'Growth', 'Scale', 'Mature']),
    status: z.enum(['active', 'at_risk', 'inactive', 'onboarding']),
    website: z.string().url(),
    notes: z.string(),
    sector: z.string(),
    forbesRank: z.number().int(),
    orderCycle: z.number().int(),
  })
  .partial()
  .strict()

// GET /api/clients/:id
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error
  const { role, orgId } = authCtx(session)

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      griReports: { orderBy: { calculatedAt: 'desc' }, take: 5 },
      reports: { orderBy: { uploadedAt: 'desc' }, take: 10 },
      projects: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!client || !mayAccess(client.orgId, role, orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseServiceKey && client.reports.length > 0) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Add signed URLs to reports
    const reportsWithUrls = await Promise.all(
      client.reports.map(async (report) => {
        const { data } = await supabase.storage
          .from('reports')
          .createSignedUrl(report.filePath, 3600)
        return { ...report, fileUrl: data?.signedUrl ?? '' }
      })
    )

    return NextResponse.json({ ...client, reports: reportsWithUrls })
  }

  return NextResponse.json(client)
}

// PATCH /api/clients/:id
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error
  const { role, orgId } = authCtx(session)

  // Authorize against the existing row BEFORE mutating (404 on missing/cross-tenant).
  const existing = await prisma.client.findUnique({
    where: { id: params.id },
    select: { orgId: true },
  })
  if (!existing || !mayAccess(existing.orgId, role, orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const client = await prisma.client.update({
    where: { id: params.id },
    data: parsed.data,
  })

  return NextResponse.json(client)
}

// DELETE /api/clients/:id — soft delete
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAuth()
  if (error) return error
  const { role, orgId } = authCtx(session)

  const existing = await prisma.client.findUnique({
    where: { id: params.id },
    select: { orgId: true },
  })
  if (!existing || !mayAccess(existing.orgId, role, orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.client.update({
    where: { id: params.id },
    data: { status: 'inactive' },
  })

  return NextResponse.json({ success: true })
}
