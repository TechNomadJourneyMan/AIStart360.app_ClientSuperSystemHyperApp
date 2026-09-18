import { redirect } from 'next/navigation'

/**
 * /client/point-a/insights — alias for the full insights timeline.
 *
 * The client cabinet lives under /client/*, while the shared feed page is
 * mounted in the (dashboard) group at /point-a/insights. E2E (2026-09) hit a
 * branded 404 on this URL from the dashboard's «Открыть полную ленту
 * обсуждений» link, so both addresses now resolve to the same page.
 */
export default function ClientPointAInsightsAlias() {
  redirect('/point-a/insights')
}
