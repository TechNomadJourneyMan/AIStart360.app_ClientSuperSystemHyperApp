/**
 * lib/diagnostics/io.ts — the two pipeline steps that go through Supabase
 * (service role) rather than the direct Postgres connection: metric
 * materialisation (lib/metrics/materialize-tenant.ts) and the Point A
 * overview (lib/point-a/overview.ts). Both already exist for the API routes;
 * the pipeline reuses them with the service client, scoped to the task's
 * company. Tests replace them with setDiagnosticsIO().
 */
import type { PointAOverview } from '@/types/point-a-overview'

export interface MaterializeSummary {
  written: number
  total: number
  skipped: number
  errors: number
}

export interface DiagnosticsIO {
  materialize(companyId: string, ownerId: string): Promise<MaterializeSummary>
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
