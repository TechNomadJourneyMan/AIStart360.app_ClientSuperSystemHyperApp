// /client/point-a — Point A of the client.
//
// With the `point_a_v4` setting on (the default): the new page (components/point-a-v4 —
// spec 2026-10-12 §4) — one Point A instead of /point-a and the old
// /client/point-a; the setting switches the engine and the page together.
// Off: the previous page, unchanged.
import { getSetting } from '@/lib/settings/store'
// The previous page (setting off) is loaded only when it is shown: with v4 on its
// client code does not reach the browser (W4).
import { ClientPointALegacy } from '@/components/point-a/legacy/lazy'
import PointAV4Page from '@/components/point-a-v4/PointAV4Page'

export const dynamic = 'force-dynamic'

export default async function PointAPage() {
  const v4 = await getSetting('point_a_v4').catch(() => true)
  return v4 ? <main><PointAV4Page /></main> : <ClientPointALegacy />
}
