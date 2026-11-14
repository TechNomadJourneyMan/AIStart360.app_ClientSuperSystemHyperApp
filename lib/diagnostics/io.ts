/**
 * lib/diagnostics/io.ts — the pipeline steps that go through Supabase
 * (service role) rather than the direct Postgres connection: metric
 * materialisation (lib/metrics/materialize-tenant.ts), the official Point A
 * recalculation (lib/point-a/snapshot.ts, R-034) and the Point A overview
 * (lib/point-a/overview.ts). All exist for the API routes; the pipeline
 * reuses them with the service client, scoped to the task's company. Tests
 * replace them with setDiagnosticsIO().
 */
import type { PointAOverview } from '@/types/point-a-overview'
import type { SnapshotResult } from '@/lib/point-a/snapshot'

export interface MaterializeSummary {
  written: number
  total: number
  skipped: number
  errors: number
}

export interface DiagnosticsIO {
  materialize(companyId: string, ownerId: string): Promise<MaterializeSummary>
  /** The ONE official Point A recalculation (writes the current diagnostic when the inputs changed). */
  snapshot(companyId: string): Promise<SnapshotResult>
  overview(companyId: string): Promise<PointAOverview>
}

const defaultIO: DiagnosticsIO = {
  async materialize(companyId, ownerId) {
    const [{ createServiceClient }, { materializeForTenant }] = await Promise.all([
      import('@/lib/supabase-service'),
      import('@/lib/metrics/materialize-tenant'),
    ])
    const service = createServiceClient()
    const { result } = await materializeForTenant(service, service, { companyId, userId: ownerId })
    return { written: result.written, total: result.total, skipped: result.skipped, errors: result.errors.length }
  },
  async snapshot(companyId) {
    const { buildPointASnapshot } = await import('@/lib/point-a/snapshot')
    return buildPointASnapshot(companyId, { trigger: 'event', reasons: ['DIAGNOSTIC_PIPELINE'], lock: true, fromPipeline: true })
  },
  async overview(companyId) {
    const [{ createServiceClient }, { loadPointAOverview }] = await Promise.all([
      import('@/lib/supabase-service'),
      import('@/lib/point-a/overview'),
    ])
    return loadPointAOverview(createServiceClient(), { companyId })
  },
}

let io: DiagnosticsIO = defaultIO

export function diagnosticsIO(): DiagnosticsIO {
  return io
}

/** Tests: replace the Supabase-backed steps. Pass null to restore the defaults. */
export function setDiagnosticsIO(next: Partial<DiagnosticsIO> | null): void {
  io = next ? { ...defaultIO, ...next } : defaultIO
}
