/**
 * lib/reports/review-http.ts — request parsing and responses shared by the
 * review routes (expert cabinet /api/expert/reports/:id/review and GIGA
 * /api/giga-admin/reports/:id/review). The decision itself is
 * lib/reports/review-flow.ts decideReportReview.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DECIDE_ERRORS, REVIEW_COMMENT_MAX, type DecideOutcome } from './review-flow'

export const ReviewBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }).strict(),
  z.object({ decision: z.literal('changes_requested'), comment: z.string().trim().min(3).max(REVIEW_COMMENT_MAX) }).strict(),
])

export function reviewResponse(res: DecideOutcome): NextResponse {
  if (res.ok) {
    return NextResponse.json({
      ok: true,
      decision: res.decision,
      already: res.already,
      reviewId: res.reviewId,
      status: res.version.status,
      version: res.version.version,
      rerun: res.rerun,
    })
  }
  const status = res.code === 'not_found' ? 404
    : res.code === 'comment_required' ? 400
      : res.code === 'audit_unavailable' ? 503
        : res.code === 'wrong_status' ? 409
          : 403
  return NextResponse.json({
    ok: false,
    error: DECIDE_ERRORS[res.code],
    code: res.code === 'mfa_required' ? 'MFA_ENROLLMENT_REQUIRED' : res.code,
    ...(res.code === 'wrong_status' ? { status: res.status, decided: res.decided } : {}),
  }, { status })
}
