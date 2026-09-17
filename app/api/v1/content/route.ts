export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { visiblePagesFor } from '@/lib/cms/server'

// GET /api/v1/content — published materials the session user may open.
export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const pages = await visiblePagesFor(user.id)
  return NextResponse.json({
    ok: true,
    data: pages.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, category: p.category, icon: p.icon, cover_url: p.cover_url, show_in_nav: p.show_in_nav, published_at: p.published_at })),
  })
}
