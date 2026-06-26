import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { MapShell, type CompanyPoint } from '../../components/map/MapShell';
import { CompanyDeepDrawer } from '../../components/drawers/CompanyDeepDrawer';
import { useCompaniesGeo } from '../../hooks/useCompaniesGeo';
import { WidgetGrid } from '../../components/widgets/WidgetGrid';
import { MacroDashboardWidget } from '../../components/widgets/MacroDashboardWidget';
import { MarketTickerBar } from '../../components/widgets/MarketTickerBar';
import { IndustryHeatmapWidget } from '../../components/widgets/IndustryHeatmapWidget';
import { TopCompaniesWidget } from '../../components/widgets/TopCompaniesWidget';
import { SizeDistributionWidget } from '../../components/widgets/SizeDistributionWidget';
import { RecentTendersWidget } from '../../components/widgets/RecentTendersWidget';
import { NewsFeedWidget } from '../../components/widgets/NewsFeedWidget';

export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute(): JSX.Element {
  // Static KZ bbox until viewport-driven bbox is wired in Phase 2.
  // zoom=12 forces the backend to return raw points (not server-side clusters)
  // so MapShell can do its own client-side clustering.
  const { data, isLoading, isError, error, refetch } = useCompaniesGeo({
    bbox: { west: 46, south: 40, east: 87, north: 55 },
    zoom: 12,
  });

  // Backend point features carry coordinates in `geometry`, not `properties`.
  // Map them into the flat CompanyPoint shape MapShell expects (skipping any
  // cluster features defensively).
  const companies = useMemo<CompanyPoint[]>(() => {
    const feats = data?.features ?? [];
    return feats
      .filter((f) => !f.properties.cluster)
      .map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        longitude: f.geometry.coordinates[0],
        latitude: f.geometry.coordinates[1],
        industry_code: f.properties.industry_code ?? null,
        industry_label: f.properties.industry_label ?? null,
        region_kato: f.properties.region_kato ?? null,
        region_name: f.properties.region_name ?? null,
        revenue_usd: f.properties.revenue_usd ?? null,
      }));
  }, [data]);

  // Stable widget nodes. Each child's React `key` is the stable id used by
  // WidgetGrid for drag/resize layout persistence (DEFAULT_TILES keys).
  // The ticker is intentionally absent — it now lives in the top
  // MarketTickerBar.
  const widgets = useMemo(
    () => [
      <MacroDashboardWidget key="macro" />,
      <IndustryHeatmapWidget key="heatmap" />,
      <TopCompaniesWidget key="top" />,
      <SizeDistributionWidget key="size" />,
      <RecentTendersWidget key="tenders" />,
      <NewsFeedWidget key="news" />,
    ],
    [],
  );

  return (
    <div className="flex w-full h-[100dvh] flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <MarketTickerBar />
      <PanelGroup direction="vertical" className="w-full min-h-0 flex-1">
        <Panel defaultSize={60} minSize={30} className="relative min-h-[420px]">
          <MapShell companies={companies} />
          {isLoading && (
            <div className="absolute top-3 right-3 z-10 rounded-md bg-white/90 px-3 py-1 text-xs shadow dark:bg-neutral-900/80">
              Loading companies…
            </div>
          )}
          {isError && (
            <div
              role="alert"
              className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 shadow dark:bg-red-950 dark:text-red-200"
            >
              <span>Failed to load companies: {error.message}</span>
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
                onClick={() => void refetch()}
              >
                Retry
              </button>
            </div>
          )}
        </Panel>
        <PanelResizeHandle className="h-1.5 bg-neutral-200 hover:bg-indigo-400 transition-colors dark:bg-neutral-800" />
        <Panel defaultSize={40} minSize={15} className="min-h-0 overflow-hidden">
          <WidgetGrid widgets={widgets} />
        </Panel>
      </PanelGroup>
      <CompanyDeepDrawer />
    </div>
  );
}
