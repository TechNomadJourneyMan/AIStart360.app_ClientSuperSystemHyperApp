// Dev-only preview of the Point A v4 page on a fixture company (real engine,
// fixture answers) — for visual checks without signing in. 404 in production.
import { notFound } from 'next/navigation'
import PointAV4Page from '@/components/point-a-v4/PointAV4Page'
import { ChatHost } from '@/components/ai-chat/ChatHost'
import { previewDetails, previewState } from './fixture'

export const dynamic = 'force-dynamic'

export default function PointAPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const state = previewState()
  return (
    <>
      <PointAV4Page preview={state} previewDetails={previewDetails(state.snapshot?.blocks ?? [])} />
      <ChatHost />
    </>
  )
}
