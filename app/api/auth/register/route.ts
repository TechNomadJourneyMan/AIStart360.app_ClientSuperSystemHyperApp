import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const schema = z.object({
  email:        z.string().email(),
  password:     z.string().min(8),
  name:         z.string().min(2),
  organization: z.string().min(2),
  position:     z.string().optional(),
})

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const { email, password, name, organization, position } = parsed.data
    const admin = getAdminClient()

    // Public registration always creates an entrepreneur applicant. Role
    // elevation to owner is performed only by the Giga approval flow.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        role: 'client',
        organization,
        position,
        status: 'pending_approval',
      },
    })

    if (error) {
      if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
        return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data.user) {
      return NextResponse.json({ error: 'UNKNOWN' }, { status: 500 })
    }

    const userId = data.user.id

    try {
      const { error: profileError } = await admin.from('profiles').upsert(
        {
          id: userId,
          email,
          full_name: name,
          role: 'client',
          status: 'pending_approval',
          organization,
          position: position ?? null,
        },
        { onConflict: 'id' },
      )
      if (profileError) throw profileError

      const { data: existingCompany, error: companyLookupError } = await admin
        .from('companies')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      if (companyLookupError) throw companyLookupError

      const companyMutation = existingCompany
        ? admin
            .from('companies')
            .update({ name: organization, updated_at: new Date().toISOString() })
            .eq('id', existingCompany.id)
            .select('id')
            .single()
        : admin
            .from('companies')
            .insert({ user_id: userId, name: organization })
            .select('id')
            .single()

      const { data: company, error: companyError } = await companyMutation
      if (companyError || !company) throw companyError ?? new Error('COMPANY_CREATE_FAILED')

      const { data: approvalRequest, error: requestError } = await admin
        .from('approval_requests')
        .upsert(
          {
            user_id: userId,
            company_id: company.id,
            request_type: 'registration',
            status: 'pending',
            priority: 'medium',
            source: 'client_portal',
            payload: { email, name, company: organization },
          },
          { onConflict: 'request_type,user_id' },
        )
        .select('id')
        .single()
      if (requestError || !approvalRequest) {
        throw requestError ?? new Error('APPROVAL_REQUEST_CREATE_FAILED')
      }

      return NextResponse.json({
        ok: true,
        userId,
        requestId: approvalRequest.id,
        status: 'pending_approval',
      }, { status: 201 })
    } catch (setupError) {
      // Auth creation cannot share a database transaction with PostgREST.
      // Compensate so a retry does not leave an unusable account behind.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
      console.error('[auth/register] onboarding setup error:', setupError)
      return NextResponse.json({ error: 'REGISTRATION_SETUP_FAILED' }, { status: 500 })
    }
  } catch (err) {
    console.error('[auth/register] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
