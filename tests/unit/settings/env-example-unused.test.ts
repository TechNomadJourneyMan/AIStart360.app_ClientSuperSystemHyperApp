/**
 * GAP-21: .env.example must not declare variables nothing reads. n8n is not
 * used (docs/platform/06-integrations.md), so no N8N_* variable is declared.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('.env.example', () => {
  it('declares no n8n variable', () => {
    const env = readFileSync('.env.example', 'utf8')
    expect(env).not.toMatch(/^\s*N8N_[A-Z_]*\s*=/m)
  })
})
