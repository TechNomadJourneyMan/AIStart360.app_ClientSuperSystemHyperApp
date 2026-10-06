/**
 * Security P2-13 (code part) — legacy documents rows keep a year-long SIGNED
 * Supabase URL in file_url. documentDownloadUrl no longer hands that stored
 * bearer URL out: it signs a fresh 1-hour link for the parsed bucket/path. A
 * public-bucket URL (readable anyway) and non-Supabase URLs keep working.
 */
import { describe, expect, it } from 'vitest'
import { documentDownloadUrl } from '@/lib/documents/client-upload'

function fakeSupabase(signed: string | null, error: string | null = null) {
  const calls: Array<{ bucket: string; path: string; expires: number }> = []
  const sb = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expires: number) => {
          calls.push({ bucket, path, expires })
          return signed ? { data: { signedUrl: signed }, error: null } : { data: null, error: error ? { message: error } : null }
        },
      }),
    },
  }
  return { sb: sb as never, calls }
}

const LEGACY_SIGNED = 'https://p.supabase.co/storage/v1/object/sign/client-documents/u1/a%20b.pdf?token=year-long-jwt'
const LEGACY_PUBLIC = 'https://p.supabase.co/storage/v1/object/public/documents/u1/x.pdf'
const legacy = (file_url: string) => ({ storage_bucket: null, storage_path: null, file_url })

describe('documentDownloadUrl — legacy rows', () => {
  it('re-signs a stored signed URL for its bucket/path instead of returning the stored token', async () => {
    const f = fakeSupabase('https://p.supabase.co/storage/v1/object/sign/client-documents/u1/a%20b.pdf?token=fresh')
    const out = await documentDownloadUrl(legacy(LEGACY_SIGNED), { supabase: f.sb })
    expect(out).toEqual({ ok: true, url: 'https://p.supabase.co/storage/v1/object/sign/client-documents/u1/a%20b.pdf?token=fresh' })
    expect(f.calls).toEqual([{ bucket: 'client-documents', path: 'u1/a b.pdf', expires: 3600 }])
  })

  it('never falls back to the stored signed URL when re-signing is refused', async () => {
    const f = fakeSupabase(null, 'Object not found')
    const out = await documentDownloadUrl(legacy(LEGACY_SIGNED), { supabase: f.sb })
    expect(out.ok).toBe(false)
    expect(JSON.stringify(out)).not.toContain('year-long-jwt')
  })

  it('a public-bucket URL is still served when it cannot be signed', async () => {
    const f = fakeSupabase(null, 'new row violates row-level security policy')
    expect(await documentDownloadUrl(legacy(LEGACY_PUBLIC), { supabase: f.sb })).toEqual({ ok: true, url: LEGACY_PUBLIC })
  })

  it('a non-Supabase URL is returned as stored', async () => {
    const f = fakeSupabase(null)
    expect(await documentDownloadUrl(legacy('https://legacy.example/x.pdf'), { supabase: f.sb })).toEqual({ ok: true, url: 'https://legacy.example/x.pdf' })
    expect(f.calls).toEqual([])
  })
})
