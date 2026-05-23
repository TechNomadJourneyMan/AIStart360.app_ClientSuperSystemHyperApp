// /client/my-data was merged into /client/point-a as the «Мои данные»
// section. This route stays as a permanent redirect so existing links and
// bookmarks land on the correct anchor.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function MyDataRedirect() {
  redirect('/client/point-a#my-data')
}
