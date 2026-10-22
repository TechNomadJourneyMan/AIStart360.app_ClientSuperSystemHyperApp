/**
 * SECURITY — the Storage bucket `documents` was public (anyone with
 * `…/object/public/documents/<path>` downloaded client files; anon could even
 * list / upload / delete). Migration 133 makes it private; the code must never
 * produce a public URL for it again:
 *
 *   - legacy answers holding a public URL are parsed to a path and opened
 *     through GET /api/v1/files/documents (access check → 10-minute signed URL);
 *   - new questionnaire uploads store `<bucket>/<path>`, never a URL;
 *   - the route lets in the owner, staff in scope and company readers only;
 *   - exports / plain views / AI contexts show «Файл: name», not Storage URLs;
 *   - no `getPublicUrl` / `.storage.from('documents')` is left in the code.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import {
  absoluteFileHref, encodeFileRef, fileHref, fileRefName, isSafeObjectPath, ownerFolderOf,
  parseLegacyStorageUrl, surveyFileLabel, surveyFileRef,
} from '@/lib/documents/survey-files'
import { decideFileAccess, FILE_SIGNED_URL_TTL_SECONDS, type FileAccessDeps, type StaffDecision } from '@/lib/documents/file-access'
import { handleFileRequest } from '@/lib/documents/file-route'
import { setDocumentStorage, type StorageLocation } from '@/lib/documents/storage'
import { documentDownloadUrl } from '@/lib/documents/client-upload'
import { formatSurveyValue } from '@/lib/survey-labels'
import { plainAnswer } from '@/lib/survey/plain'
import { buildSurveySheetRow } from '@/lib/survey/export'
import Step6CJMForm from '@/components/onboarding/steps/Step6CJMForm'

const OWNER = 'f298c973-82fa-44be-8509-5a388420d2f0'
const OTHER = '7cdb03d1-bc3d-49a5-bd95-0b93adab4bc6'
const STAFF = '11111111-1111-4111-8111-111111111111'
const HOST = 'https://tpxwrwxpdcwmiynjjquy.supabase.co'
const LEGACY_URL = `${HOST}/storage/v1/object/public/documents/${OWNER}/s6n_script_meeting/1776160880796.pdf`

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = HOST
})

// ─── Legacy URL → path ──────────────────────────────────────────────────────

describe('legacy public URL → storage path', () => {
  it('parses a public URL of the documents bucket', () => {
    expect(parseLegacyStorageUrl(LEGACY_URL)).toEqual({ bucket: 'documents', path: `${OWNER}/s6n_script_meeting/1776160880796.pdf` })
  })

  it('decodes URL-encoded names (spaces, parentheses, Cyrillic)', () => {
    const url = `${HOST}/storage/v1/object/public/documents/${OTHER}/1775983909389_ML_Bielorussie%20-%20MIA%20Gascogne%20-%20mars%202026%20SBOR-CRN-RD26031609260%20ru.pdf`
    expect(parseLegacyStorageUrl(url)?.path).toBe(`${OTHER}/1775983909389_ML_Bielorussie - MIA Gascogne - mars 2026 SBOR-CRN-RD26031609260 ru.pdf`)
    const paren = `${HOST}/storage/v1/object/public/documents/${OTHER}/1775822728322_pulse_export_2026-04-03%20(1).csv`
    expect(parseLegacyStorageUrl(paren)?.path).toBe(`${OTHER}/1775822728322_pulse_export_2026-04-03 (1).csv`)
    const encodedParen = `${HOST}/storage/v1/object/public/documents/${OTHER}/a%20%281%29.csv`
    expect(parseLegacyStorageUrl(encodedParen)?.path).toBe(`${OTHER}/a (1).csv`)
    const cyr = `${HOST}/storage/v1/object/public/documents/${OWNER}/${encodeURIComponent('Договор (итог).docx')}`
    expect(parseLegacyStorageUrl(cyr)?.path).toBe(`${OWNER}/Договор (итог).docx`)
  })

  it('accepts signed / authenticated forms and client-documents; refuses other hosts, buckets and traversal', () => {
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/sign/documents/${OWNER}/a.pdf?token=x`)).toEqual({ bucket: 'documents', path: `${OWNER}/a.pdf` })
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/public/client-documents/${OWNER}/a.pdf`)).toEqual({ bucket: 'client-documents', path: `${OWNER}/a.pdf` })
    expect(parseLegacyStorageUrl(`https://evil.example/storage/v1/object/public/documents/${OWNER}/a.pdf`)).toBeNull()
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/public/cms-media/uploads/a.png`)).toBeNull()
    // `%2e%2e` is resolved by URL itself: the result names the folder it really points at (access is checked on it).
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/public/documents/${OWNER}/%2e%2e/${OTHER}/a.pdf`)).toEqual({ bucket: 'documents', path: `${OTHER}/a.pdf` })
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/public/documents/${OWNER}/a%2F..%2F..%2Fx.pdf`)).toBeNull()
    expect(parseLegacyStorageUrl(`${HOST}/storage/v1/object/public/documents/${OWNER}/bad%ZZ.pdf`)).toBeNull()
    expect(parseLegacyStorageUrl('not a url')).toBeNull()
  })

  it('stored answer values: new `<bucket>/<path>` and legacy URLs resolve; free text and root objects do not', () => {
    const ref = { bucket: 'client-documents' as const, path: `${OWNER}/aaaa.pdf` }
    expect(encodeFileRef(ref)).toBe(`client-documents/${OWNER}/aaaa.pdf`)
    expect(surveyFileRef(encodeFileRef(ref))).toEqual(ref)
    expect(surveyFileRef({ value: LEGACY_URL })?.bucket).toBe('documents')
    expect(surveyFileRef('Звоним, представляемся, выясняем потребность')).toBeNull()
    expect(surveyFileRef(`${OWNER}/aaaa.pdf`)).toBeNull() // no bucket prefix
    expect(surveyFileRef('documents/1775818815053_Contract.docx')).toBeNull() // root-level object
    expect(surveyFileRef('documents/../etc/passwd')).toBeNull()
    expect(surveyFileRef(42)).toBeNull()
  })

  it('links go to the access-checked route, never to Storage', () => {
    const ref = { bucket: 'documents' as const, path: `${OTHER}/a (1) & b.csv` }
    const href = fileHref(ref)
    expect(href.startsWith('/api/v1/files/documents?')).toBe(true)
    const q = new URL(href, 'https://portal.example').searchParams
    expect(q.get('bucket')).toBe('documents')
    expect(q.get('path')).toBe(`${OTHER}/a (1) & b.csv`)
    expect(absoluteFileHref(ref, 'https://portal.aistart360.app/')).toBe(`https://portal.aistart360.app${href}`)
    expect(href).not.toContain('supabase')
    expect(fileRefName(ref)).toBe('a (1) & b.csv')
  })

  it('path helpers', () => {
    expect(ownerFolderOf(`${OWNER}/x/y.pdf`)).toBe(OWNER)
    expect(ownerFolderOf('1775818815053_Contract.docx')).toBeNull()
    expect(ownerFolderOf('uploads/x.pdf')).toBeNull()
    expect(isSafeObjectPath(`${OWNER}/a.pdf`)).toBe(true)
    for (const bad of ['', '/abs', 'a//b', 'a/../b', 'a\\b', 'a/\u0000b', 'x'.repeat(1025)]) expect(isSafeObjectPath(bad)).toBe(false)
  })
})

// ─── Access decision ────────────────────────────────────────────────────────

function deps(opts: { viewer?: string | null; staff?: StaffDecision; company?: boolean } = {}) {
  const calls = { staff: 0, company: 0 }
  const d: FileAccessDeps = {
    viewerId: async () => opts.viewer ?? null,
    staffDecision: async () => { calls.staff += 1; return opts.staff ?? 'none' },
    canReadOwnerCompany: async () => { calls.company += 1; return opts.company ?? false },
  }
  return { d, calls }
}

const OWNER_FILE = { bucket: 'documents' as const, path: `${OWNER}/s6n_script_meeting/1776160880796.pdf` }

describe('decideFileAccess', () => {
  it('the owner opens their own file without staff / company lookups', async () => {
    const { d, calls } = deps({ viewer: OWNER })
    expect(await decideFileAccess(OWNER_FILE, d)).toEqual({ ok: true, ownerId: OWNER, via: 'owner' })
    expect(calls).toEqual({ staff: 0, company: 0 })
  })

  it('another client gets 404 (existence is not confirmed)', async () => {
    const { d } = deps({ viewer: OTHER })
    expect(await decideFileAccess(OWNER_FILE, d)).toMatchObject({ ok: false, status: 404 })
  })

  it('anonymous caller gets 401', async () => {
    const { d } = deps({ viewer: null })
    expect(await decideFileAccess(OWNER_FILE, d)).toMatchObject({ ok: false, status: 401 })
  })

  it('staff with permission and the client in scope: allowed; out of scope / refused: 403, no fallback to company', async () => {
    expect(await decideFileAccess(OWNER_FILE, deps({ viewer: STAFF, staff: 'allow' }).d)).toEqual({ ok: true, ownerId: OWNER, via: 'staff' })
    // A staff_cookie actor during impersonation may have no Supabase session of their own.
    expect(await decideFileAccess(OWNER_FILE, deps({ viewer: null, staff: 'allow' }).d)).toMatchObject({ ok: true, via: 'staff' })
    const refused = deps({ viewer: STAFF, staff: 'deny', company: true })
    expect(await decideFileAccess(OWNER_FILE, refused.d)).toMatchObject({ ok: false, status: 403 })
    expect(refused.calls.company).toBe(0)
  })

  it('a reader of the owner company (can_read_company) is allowed', async () => {
    expect(await decideFileAccess(OWNER_FILE, deps({ viewer: OTHER, company: true }).d)).toEqual({ ok: true, ownerId: OWNER, via: 'company' })
  })

  it('root-level legacy objects are never served; traversal is 400', async () => {
    const root = { bucket: 'documents' as const, path: '1775818815053_Contract.docx' }
    expect(await decideFileAccess(root, deps({ viewer: STAFF, staff: 'allow' }).d)).toMatchObject({ ok: false, status: 404 })
    expect(await decideFileAccess(root, deps({ viewer: null }).d)).toMatchObject({ ok: false, status: 401 })
    expect(await decideFileAccess({ bucket: 'documents', path: `${OTHER}/../${OWNER}/a.pdf` }, deps({ viewer: OTHER }).d)).toMatchObject({ ok: false, status: 400 })
  })
})

// ─── Route handler ──────────────────────────────────────────────────────────

describe('GET /api/v1/files/documents', () => {
  const signed: Array<{ loc: StorageLocation; ttl: number }> = []
  const fakeStorage = (url: string | null) => {
    setDocumentStorage({
      download: async () => Buffer.alloc(0),
      remove: async () => {},
      signedUrl: async (loc, ttl) => { signed.push({ loc, ttl }); return url },
    })
  }
  afterEach(() => { setDocumentStorage(null); signed.length = 0 })

  const req = (q: Record<string, string>) =>
    new NextRequest(`https://portal.example/api/v1/files/documents?${new URLSearchParams(q).toString()}`)

  it('owner → 302 to a 10-minute signed URL, no-store', async () => {
    fakeStorage(`${HOST}/storage/v1/object/sign/documents/${OWNER}/a.pdf?token=t`)
    const res = await handleFileRequest(req({ path: OWNER_FILE.path }), deps({ viewer: OWNER }).d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/object/sign/documents/')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(signed).toEqual([{ loc: OWNER_FILE, ttl: 600 }])
    expect(FILE_SIGNED_URL_TTL_SECONDS).toBe(600)
  })

  it('format=json returns the signed URL; bucket=client-documents is supported', async () => {
    fakeStorage('https://signed.example/x')
    const res = await handleFileRequest(req({ bucket: 'client-documents', path: `${OWNER}/a.pdf`, format: 'json' }), deps({ viewer: OWNER }).d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, url: 'https://signed.example/x', expires_in: 600 })
    expect(signed[0].loc).toEqual({ bucket: 'client-documents', path: `${OWNER}/a.pdf` })
  })

  it('a refused caller never gets a signature', async () => {
    fakeStorage('https://signed.example/x')
    expect((await handleFileRequest(req({ path: OWNER_FILE.path }), deps({ viewer: OTHER }).d)).status).toBe(404)
    expect((await handleFileRequest(req({ path: OWNER_FILE.path }), deps({ viewer: null }).d)).status).toBe(401)
    expect((await handleFileRequest(req({ path: OWNER_FILE.path }), deps({ viewer: STAFF, staff: 'deny' }).d)).status).toBe(403)
    expect(signed).toEqual([])
  })

  it('other buckets (cms-media, report-pdfs) are refused; a missing object is 404', async () => {
    fakeStorage(null)
    expect((await handleFileRequest(req({ bucket: 'cms-media', path: `${OWNER}/a.png` }), deps({ viewer: OWNER }).d)).status).toBe(400)
    expect((await handleFileRequest(req({ bucket: 'report-pdfs', path: `${OWNER}/a.pdf` }), deps({ viewer: OWNER }).d)).status).toBe(400)
    expect((await handleFileRequest(req({ path: OWNER_FILE.path }), deps({ viewer: OWNER }).d)).status).toBe(404)
  })

  it('a failing access lookup is 503, never access', async () => {
    fakeStorage('https://signed.example/x')
    const d: FileAccessDeps = { viewerId: async () => OTHER, staffDecision: async () => { throw new Error('db down') }, canReadOwnerCompany: async () => true }
    expect((await handleFileRequest(req({ path: OWNER_FILE.path }), d)).status).toBe(503)
    expect(signed).toEqual([])
  })
})

// ─── Rendering, exports, plain views ────────────────────────────────────────

describe('step 6 and the views use the route', () => {
  it('Step 6 «Открыть» on a legacy public URL points at the route, not at Storage', () => {
    const html = renderToStaticMarkup(createElement(Step6CJMForm, {
      data: { s6n_script_meeting: LEGACY_URL, s6n_script_first_contact: `client-documents/${OWNER}/bbbb.docx` },
      onChange: () => {},
      userId: OWNER,
    }))
    expect(html).not.toContain('/object/public/')
    expect(html).not.toContain('supabase.co')
    expect(html).toContain(`href="/api/v1/files/documents?bucket=documents&amp;path=${encodeURIComponent(`${OWNER}/s6n_script_meeting/1776160880796.pdf`)}"`)
    expect(html).toContain(`href="/api/v1/files/documents?bucket=client-documents&amp;path=${encodeURIComponent(`${OWNER}/bbbb.docx`)}"`)
    expect(html).toContain('1776160880796.pdf')
  })

  it('formatSurveyValue / plainAnswer show the file name, not a URL or path', () => {
    expect(formatSurveyValue('s6n_script_meeting', { value: LEGACY_URL })).toBe('Файл: 1776160880796.pdf')
    expect(formatSurveyValue('s6n_script_proposal', `client-documents/${OWNER}/c.pdf`)).toBe('Файл: c.pdf')
    expect(formatSurveyValue('s6n_script_proposal', 'https://legacy.example/x.pdf')).toBe('Файл загружен')
    expect(plainAnswer(LEGACY_URL)).toBe('Файл: 1776160880796.pdf')
    expect(surveyFileLabel('просто текст')).toBeNull()
  })

  it('the Google Sheets row links to the portal route', () => {
    const row = buildSurveySheetRow(
      [{ question_key: 's6n_script_meeting', step: 6, answer: { value: LEGACY_URL } }] as never,
      { userId: OWNER },
    )
    const cell = row.find((c) => c.includes('1776160880796.pdf'))
    expect(cell).toBeDefined()
    expect(cell).toContain('/api/v1/files/documents?bucket=documents&path=')
    expect(row.join(' ')).not.toContain('/object/public/')
  })

  it('documentDownloadUrl never returns a public URL of the documents bucket', async () => {
    const sb = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'denied' } }) }) } } as never
    const legacyPublic = await documentDownloadUrl({ storage_bucket: null, storage_path: null, file_url: LEGACY_URL }, { supabase: sb })
    expect(legacyPublic).toEqual({ ok: true, url: fileHref(OWNER_FILE) })
    const bare = await documentDownloadUrl({ storage_bucket: null, storage_path: null, file_url: `${OWNER}/medical/1_base.xlsx` }, { supabase: sb })
    expect(bare).toEqual({ ok: true, url: fileHref({ bucket: 'documents', path: `${OWNER}/medical/1_base.xlsx` }) })
    const otherPublic = await documentDownloadUrl({ storage_bucket: null, storage_path: null, file_url: `${HOST}/storage/v1/object/public/client-documents/${OWNER}/a.pdf` }, { supabase: sb })
    expect(otherPublic.ok).toBe(false)
  })
})

// ─── Static guard ───────────────────────────────────────────────────────────

const ROOT = join(__dirname, '..', '..', '..')
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

describe('no public URL of the documents bucket is produced anywhere', () => {
  const files = ['app', 'components', 'lib', 'hooks', 'stores', 'services']
    .flatMap((d) => { try { return sourceFiles(join(ROOT, d)) } catch { return [] } })

  it('getPublicUrl only for the intentionally public cms-media bucket', () => {
    const users = files.filter((f) => /getPublicUrl\s*\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))
    expect(users).toEqual(['app/api/giga-admin/content/media/route.ts'])
    expect(readFileSync(join(ROOT, 'app/api/giga-admin/content/media/route.ts'), 'utf8')).toMatch(/BUCKET\s*=\s*['"]cms-media['"]/)
  })

  it('no client code touches the documents bucket and no code builds an /object/public/ URL', () => {
    for (const f of files) {
      // Code only: block and line comments may describe the legacy URL shape.
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(src, relative(ROOT, f)).not.toMatch(/storage\s*\.from\(\s*['"`]documents['"`]\s*\)/)
      expect(src, relative(ROOT, f)).not.toMatch(/['"`][^'"`\n]*\/object\/public\/documents/)
    }
  })
})
