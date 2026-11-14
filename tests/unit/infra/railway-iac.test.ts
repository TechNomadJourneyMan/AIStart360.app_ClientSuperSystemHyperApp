/**
 * R-020 — .railway/railway.ts (Railway IaC, draft) restates the portal settings of the deprecated
 * railway.json and must stay a named partial: without `partial`, `railway config apply` would
 * delete every project resource missing from the file (self-hosted Supabase, Postgres, backups).
 * Text checks only — the `railway` SDK is not a dependency.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const iac = readFileSync(path.join(root, '.railway/railway.ts'), 'utf8')
const cac = JSON.parse(readFileSync(path.join(root, 'railway.json'), 'utf8'))

describe('R-020 .railway/railway.ts', () => {
  it('R-020: is a named partial owning only the portal', () => {
    expect(iac).toMatch(/^export const partial = 'portal'$/m)
    expect(iac).toContain("service('portal'")
  })

  it('R-020: same build, start and healthcheck as railway.json', () => {
    expect(iac).toContain(`build: '${cac.build.buildCommand}'`)
    expect(iac).toContain(`start: '${cac.deploy.startCommand}'`)
    expect(iac).toContain(`healthcheck: '${cac.deploy.healthcheckPath}'`)
    expect(iac).toContain(`healthcheckTimeout: ${cac.deploy.healthcheckTimeout}`)
    expect(iac).toContain(cac.deploy.preDeployCommand[0])
  })

  it('R-020: declares no variables (secrets stay in Railway)', () => {
    expect(iac).not.toMatch(/^\s*env\s*:/m)
  })
})
