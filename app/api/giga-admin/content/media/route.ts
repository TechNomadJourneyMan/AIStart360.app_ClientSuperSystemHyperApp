export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { slugify } from '@/lib/cms/blocks'

// GET  /api/giga-admin/content/media — files in the cms-media bucket.
// POST /api/giga-admin/content/media (multipart: file) — upload one file.
// DELETE /api/giga-admin/content/media { name } — remove a file (content.publish);
//        refused while a page or block still references it.
// Type is checked by magic bytes, not by the client-declared MIME.
const BUCKET = 'cms-media'
const MAX_BYTES = 25 * 1024 * 1024

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Uint8Array) => boolean }> = [
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', ext: 'webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: 'video/mp4', ext: 'mp4', test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  { mime: 'video/webm', ext: 'webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
]

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'content.view')
  if (guard.response) return guard.response
  const sb = createServiceClient()
  const { data, error } = await sb.storage.from(BUCKET).list('uploads', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить файлы' }, { status: 500 })
  return NextResponse.json({
    ok: true,
    data: (data ?? []).filter((f) => f.id).map((f) => ({
      name: f.name,
      // Display name without the unique «<time>-<rand>-» prefix.
      title: f.name.replace(/^[a-z0-9]+-[a-f0-9]{8}-/, ''),
      size: (f.metadata as { size?: number } | null)?.size ?? null,
      mime: (f.metadata as { mimetype?: string } | null)?.mimetype ?? null,
      created_at: f.created_at,
      url: sb.storage.from(BUCKET).getPublicUrl(`uploads/${f.name}`).data.publicUrl,
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, 'content.edit')
  if (guard.response) return guard.response
  if (await isRateLimitedKey(guard.actor.id, 'cms-upload', { max: 30, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много загрузок. Попробуйте позже.' }, { status: 429 })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Файл не передан' }, { status: 400 })
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Размер файла — до 25 МБ' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = SIGNATURES.find((s) => s.test(bytes))
  if (!kind) return NextResponse.json({ ok: false, error: 'Разрешены PNG, JPG, GIF, WEBP, PDF, MP4, WEBM' }, { status: 415 })

  // Readable, safe name: transliterated original (Cyrillic kept as Latin).
  const base = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 60) || 'file'
  const path = `uploads/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}-${base}.${kind.ext}`
  const sb = createServiceClient()
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false, cacheControl: '31536000' })
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить файл' }, { status: 500 })
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  await recordAdminAction(guard.actor, { action: 'content.media_uploaded', entityType: 'cms_media', entityId: path, newValue: { url, mime: kind.mime, size: file.size, original: file.name.slice(0, 120) } }, req)
  return NextResponse.json({ ok: true, data: { url, mime: kind.mime, size: file.size, name: file.name, title: `${base}.${kind.ext}` } })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireGiga(req, 'content.publish')
  if (guard.response) return guard.response
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!/^[a-z0-9][a-z0-9.-]{0,120}$/.test(name)) return NextResponse.json({ ok: false, error: 'Неверное имя файла' }, { status: 400 })
  const sb = createServiceClient()
  const path = `uploads/${name}`
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  // A published link must never break silently.
  const [pagesRes, blocksRes] = await Promise.all([
    sb.from('cms_pages').select('id, title').eq('cover_url', url).limit(5),
    sb.from('cms_blocks').select('page_id, content').or(`content->>url.eq.${url},content->>href.eq.${url}`).limit(5),
  ])
  const used = (pagesRes.data?.length ?? 0) + (blocksRes.data?.length ?? 0)
  if (used > 0) {
    return NextResponse.json({ ok: false, error: 'Файл используется на страницах — сначала уберите его оттуда' }, { status: 409 })
  }

  await recordAdminAction(guard.actor, { action: 'content.media_deleted', entityType: 'cms_media', entityId: path, oldValue: { url }, newValue: null }, req, { required: true })
  const { error } = await sb.storage.from(BUCKET).remove([path])
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить файл' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
