export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { visibleSectionsFor } from '@/lib/platform/sections'

// GET /api/v1/platform/sections — cabinet sections visible to the session user
// (navigation hides the rest; middleware blocks direct access to them).
export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { sections, hiddenPaths } = await visibleSectionsFor(user.id)
  return NextResponse.json({
    ok: true,
    data: {
      sections: sections.map((s) => ({ key: s.key, title: s.title, description: s.description, icon: s.icon, href: s.nav_href })),
      hiddenPaths,
    },
  })
}
