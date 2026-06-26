import type { WidgetRead } from '@/types/widgets';
import { ChartWidget } from './ChartWidget';
import { ListWidget } from './ListWidget';
import { MapMiniWidget } from './MapMiniWidget';
import { MetricWidget } from './MetricWidget';
import { NewsWidget } from './NewsWidget';
import { NoteWidget } from './NoteWidget';

export { WidgetFrame } from './WidgetFrame';
export { ChartWidget, ListWidget, MapMiniWidget, MetricWidget, NewsWidget, NoteWidget };

/**
 * Type-driven dispatcher used by the dashboard to render an arbitrary
 * user widget. Add a new entry here when adding a new widget type.
 */
export function renderWidgetByType(
  widget: WidgetRead,
  callbacks?: { onEdit?: () => void; onDelete?: () => void },
): JSX.Element {
  const props = {
    widget,
    ...(callbacks?.onEdit ? { onEdit: callbacks.onEdit } : {}),
    ...(callbacks?.onDelete ? { onDelete: callbacks.onDelete } : {}),
  };
  switch (widget.type) {
    case 'metric':
      return <MetricWidget {...props} />;
    case 'list':
      return <ListWidget {...props} />;
    case 'chart':
      return <ChartWidget {...props} />;
    case 'map_mini':
      return <MapMiniWidget {...props} />;
    case 'news':
      return <NewsWidget {...props} />;
    case 'note':
      return <NoteWidget {...props} />;
    default: {
      const exhaustive: never = widget.type;
      return (
        <div className="p-2 text-xs text-red-600">Unknown widget type: {String(exhaustive)}</div>
      );
    }
  }
}
