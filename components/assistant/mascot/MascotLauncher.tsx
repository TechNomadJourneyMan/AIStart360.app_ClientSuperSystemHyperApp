'use client'

/**
 * components/assistant/mascot/MascotLauncher.tsx — the layout entry point.
 *
 * Replaces <AssistantChatLauncher/> in the two layouts. Behavior (ТЗ §15.3):
 *   • NEXT_PUBLIC_FEATURE_MASCOT='0'  → the old static launcher (kill switch);
 *   • otherwise                        → the mascot, loaded lazily
 *     (next/dynamic, ssr:false) so the cat never blocks first paint;
 *   • a chunk-load failure or a runtime crash inside the mascot falls back to
 *     the old launcher via the error boundary — assistant access survives.
 */

import { Component, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { AssistantChatLauncher } from '@/components/assistant/AssistantChatPanel'

const MascotAssistant = dynamic(() => import('./MascotAssistant'), {
  ssr: false,
  loading: () => null,
})

class MascotErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[mascot] crashed — falling back to the static launcher:', error)
  }

  render() {
    if (this.state.failed) return <AssistantChatLauncher />
    return this.props.children
  }
}

export function MascotLauncher() {
  if (process.env.NEXT_PUBLIC_FEATURE_MASCOT === '0') {
    return <AssistantChatLauncher />
  }
  return (
    <MascotErrorBoundary>
      <MascotAssistant />
    </MascotErrorBoundary>
  )
}
