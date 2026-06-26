import { useMemo } from 'react';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { MapShell } from '@/components/map/MapShell';
import { useWidgetData } from '@/hooks/useWidgetData';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface MapMiniWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function MapMiniWidget({ widget, onEdit, onDelete }: MapMiniWidgetProps): JSX.Element {
  const { data, isLoading, isError, error } = useWidgetData(widget);
  const title = typeof widget.params.title === 'string' ? widget.params.title : widget.name;

  const mapData = data && data.type === 'map_mini' ? data : null;

  const bounds: LngLatBoundsLike | undefined = useMemo(() => {
    if (!mapData) return undefined;
    const { west, south, east, north } = mapData.bbox;
    return [
      [west, south],
      [east, north],
    ];
  }, [mapData]);

  const companies = useMemo(() => {
    if (!mapData?.points) return undefined;
    return mapData.points.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      longitude: p.longitude,
      latitude: p.latitude,
    }));
  }, [mapData]);

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      <div className="relative h-full w-full overflow-hidden rounded">
        {bounds && (
          <MapShell
            compact
            initialBounds={bounds}
            {...(companies ? { companies } : {})}
          />
        )}
      </div>
    </WidgetFrame>
  );
}

export default MapMiniWidget;
