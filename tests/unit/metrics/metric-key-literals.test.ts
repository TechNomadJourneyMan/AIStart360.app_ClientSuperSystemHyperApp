/**
 * Every literal `metric_key` filter in the code must name a metric that the
 * registry materialises. A key nobody writes (e.g. the old 'revenue') reads
 * nothing forever and silently empties a screen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMetricRegistry } from '@/lib/metrics/registry'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('metric_key literals', () => {
  it('only name registry metrics', () => {
    const ids = new Set(getMetricRegistry().map((m) => m.id))
    const unknown: string[] = []
    for (const f of [...files('app'), ...files('lib'), ...files('components')]) {
      const src = readFileSync(f, 'utf8')
      // Query filters only: .eq('metric_key', '<id>') / .neq(…) / .match-like calls.
      for (const m of src.matchAll(/\.(?:eq|neq)\(\s*['"]metric_key['"]\s*,\s*['"]([^'"]+)['"]/g)) {
        if (!ids.has(m[1])) unknown.push(`${f}: ${m[1]}`)
      }
    }
    expect(unknown).toEqual([])
  })
})
