import { createServiceClient } from '@/lib/supabase-service'
import { getUserFacts } from '@/lib/platform/facts'
import { isVisible } from '@/lib/platform/visibility'

export interface CmsPage {
  id: string; slug: string; title: string; summary: string | null; category: string | null; icon: string | null
  cover_url: string | null; status: 'draft' | 'published' | 'archived'; visibility: unknown; show_in_nav: boolean
  sort_order: number; version: number; published_at: string | null; created_by: string | null; updated_by: string | null
  created_at: string; updated_at: string
}
export interface CmsBlock { id: string; page_id: string; type: string; content: Record<string, unknown>; sort_order: number; hidden: boolean; visibility: unknown }

export const PAGE_COLUMNS = 'id, slug, title, summary, category, icon, cover_url, status, visibility, show_in_nav, sort_order, version, published_at, created_by, updated_by, created_at, updated_at'

export async function loadPageWithBlocks(by: { id?: string; slug?: string }): Promise<{ page: CmsPage; blocks: CmsBlock[] } | null> {
  const sb = createServiceClient()
  let q = sb.from('cms_pages').select(PAGE_COLUMNS)
  q = by.id ? q.eq('id', by.id) : q.eq('slug', by.slug ?? '')
  const { data: page } = await q.maybeSingle()
  if (!page) return null
  const { data: blocks } = await sb.from('cms_blocks').select('id, page_id, type, content, sort_order, hidden, visibility').eq('page_id', page.id).order('sort_order', { ascending: true })
  return { page: page as CmsPage, blocks: (blocks ?? []) as CmsBlock[] }
}

/** Published page as a given user may see it (null when hidden or missing). */
export async function publishedPageFor(slug: string, userId: string | null) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null
  const [loaded, facts] = await Promise.all([loadPageWithBlocks({ slug }), getUserFacts(userId)])
  if (!loaded || loaded.page.status !== 'published') return null
  if (!isVisible(loaded.page.visibility, facts)) return null
  return { page: loaded.page, blocks: loaded.blocks.filter((b) => !b.hidden && (b.visibility == null || isVisible(b.visibility, facts))) }
}

/** Published pages this user may open, in menu order. */
export async function visiblePagesFor(userId: string | null): Promise<CmsPage[]> {
  const [{ data }, facts] = await Promise.all([
    createServiceClient().from('cms_pages').select(PAGE_COLUMNS).eq('status', 'published').order('sort_order', { ascending: true }).order('published_at', { ascending: false }),
    getUserFacts(userId),
  ])
  return ((data ?? []) as CmsPage[]).filter((p) => isVisible(p.visibility, facts))
}
