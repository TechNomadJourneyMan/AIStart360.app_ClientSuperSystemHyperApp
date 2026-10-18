// Dev-only, read-only preview of the cabinet pop-up layer on fixture data (no
// database, no API calls) — for visual checks without signing in. 404 in
// production, like /dev/point-a-preview and /dev/point-b-preview.
import { notFound } from 'next/navigation'
import PopupsPreview from './preview'

export const dynamic = 'force-dynamic'

export default function PopupsPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PopupsPreview />
}
