import { NextResponse } from 'next/server'
import { BillingError } from './billing'

/** HTTP answer for a failed billing operation (GIGA routes). Honest, no stack. */
export function billingErrorResponse(err: unknown, where: string): NextResponse {
  if (err instanceof BillingError) {
    switch (err.code) {
      case 'invalid':
        return NextResponse.json({ ok: false, error: 'invalid', message: err.message }, { status: 422 })
      case 'not_found':
        return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
      case 'migration_106_required':
        return NextResponse.json({ ok: false, error: 'migration_106_required', message: 'Миграция 106 не применена — тариф нельзя изменить' }, { status: 503 })
      case 'audit_unavailable':
        return NextResponse.json({ ok: false, error: 'audit_unavailable', message: err.message }, { status: 503 })
      default:
        break
    }
  }
  console.error(`[${where}]`, err instanceof Error ? err.message : err)
  return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
}
