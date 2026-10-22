/**
 * The serverless functions run next to the database (W4). Supabase (DB, Auth, PostgREST) is in AWS
 * eu-west-1 (Ireland); without `regions` Vercel ran the functions in iad1 (Washington), so every one of
 * the many sequential DB / Auth round trips of a page crossed the Atlantic (~75 ms each). dub1 is
 * Vercel's Dublin region — the same AWS region as the database.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('vercel.json', () => {
  it('pins the functions to dub1 (next to Supabase eu-west-1) and keeps the crons', () => {
    const cfg = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as { regions?: string[]; crons?: unknown[] }
    expect(cfg.regions).toEqual(['dub1'])
    expect(Array.isArray(cfg.crons) && cfg.crons.length).toBeGreaterThan(0)
  })
})
