import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Public self-registration. Only the two roles offered in the UI are allowed
// ('client' = бизнес, 'owner' = команда AIStart360). admin/expert/super_admin
// can NEVER be self-assigned — staff are created by an admin. See audit A3.
const schema = z.object({
  email:        z.string().email(),
  password:     z.string().min(6),
  name:         z.string().min(2),
  role:         z.enum(['client', 'owner']).optional().default('client'),
  organization: z.string().optional(),
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

    const { email, password, name, role, organization, position } = parsed.data
    const admin = getAdminClient()

    // Every self-registration starts pending — an admin must approve before any
    // elevated access. Never auto-approve based on the requested role. Audit A3.
    const status = 'pending_approval'

    // Create user via admin API — email_confirm: true skips verification entirely
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role, organization, position, status },
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

    return NextResponse.json({ ok: true, userId: data.user.id }, { status: 201 })
  } catch (err) {
    console.error('[auth/register] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
