import { journeyWidgetSchema } from '@/lib/journey/schema'
import type { JourneyWorkspaceView } from './model'

/**
 * Keeps user-owned layout while respecting an explicit AI lifecycle decision.
 * Normal updates may not reopen a widget the user hid. Conversely, `hide`
 * retires an obsolete module unless the user manually positioned/pinned it.
 */
export function preserveUserWidgetState(
  incoming: JourneyWorkspaceView,
  latest: JourneyWorkspaceView,
): JourneyWorkspaceView {
  const latestWidgets = new Map(latest.widgets.map((widget) => [widget.id, widget]))
  const incomingIds = new Set(incoming.widgets.map((widget) => widget.id))
  const manualIds = new Set(latest.manualWidgetIds ?? [])
  const decisions = new Map(
    (incoming.widgetDecisions ?? []).map((decision) => [decision.widgetId, decision]),
  )

  return {
    ...incoming,
    manualWidgetIds: (latest.manualWidgetIds ?? []).filter((id) => incomingIds.has(id)),
    widgetOrder: (latest.widgetOrder ?? []).filter((id) => incomingIds.has(id)),
    widgets: incoming.widgets.map((widget) => {
      const previous = latestWidgets.get(widget.id)
      if (!previous) return widget
      const explicitRetirement = decisions.get(widget.id)?.action === 'hide'
      return journeyWidgetSchema.parse({
        ...widget,
        collapsed: previous.collapsed,
        hidden: explicitRetirement && !manualIds.has(widget.id) ? true : previous.hidden,
        focused: previous.focused,
        position: previous.position,
      })
    }),
  }
}
