/**
 * lib/upload-url (I1, from P's cloud audit): a stored document URL is accepted only from OUR Supabase
 * Storage origin. Without NEXT_PUBLIC_SUPABASE_URL nothing is accepted (fail closed) — the old fallback let
 * any *.supabase.co / *.supabase.in project through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSupabaseStorageUrl } from '@/lib/upload-url'

const OBJ = '/storage/v1/object/public/documents/u1/a.pdf'

afterEach(() => vi.unstubAllEnvs())

describe('isSupabaseStorageUrl', () => {
  it('no env → nothing, not even a *.supabase.co URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(isSupabaseStorageUrl(`https://evil-project.supabase.co${OBJ}`)).toBe(false)
    expect(isSupabaseStorageUrl(`https://x.supabase.in${OBJ}`)).toBe(false)
  })

  it('only the origin of NEXT_PUBLIC_SUPABASE_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.app')
    expect(isSupabaseStorageUrl(`https://supabase.example.app${OBJ}`)).toBe(true)
    expect(isSupabaseStorageUrl(`https://evil-project.supabase.co${OBJ}`)).toBe(false)
    expect(isSupabaseStorageUrl(`https://supabase.example.app:8443${OBJ}`)).toBe(false)
    expect(isSupabaseStorageUrl(`http://supabase.example.app${OBJ}`)).toBe(false)
    expect(isSupabaseStorageUrl('https://supabase.example.app/rest/v1/profiles')).toBe(false)
  })

  it('a malformed env value → nothing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url')
    expect(isSupabaseStorageUrl(`https://supabase.example.app${OBJ}`)).toBe(false)
  })
})
