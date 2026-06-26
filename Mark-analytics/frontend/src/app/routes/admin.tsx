import { createFileRoute, Link } from '@tanstack/react-router';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { MapShell } from '../../components/map/MapShell';
import { CompanyDeepDrawer } from '../../components/drawers/CompanyDeepDrawer';
import { WidgetGrid } from '../../components/widgets/WidgetGrid';
import { MacroDashboardWidget } from '../../components/widgets/MacroDashboardWidget';
import { MarketTickerWidget } from '../../components/widgets/MarketTickerWidget';
import { IndustryHeatmapWidget } from '../../components/widgets/IndustryHeatmapWidget';
import { TopCompaniesWidget } from '../../components/widgets/TopCompaniesWidget';
import { SizeDistributionWidget } from '../../components/widgets/SizeDistributionWidget';
import { RecentTendersWidget } from '../../components/widgets/RecentTendersWidget';
import { NewsFeedWidget } from '../../components/widgets/NewsFeedWidget';
import { AnalystDrawer } from '../../components/analyst/AnalystDrawer';
import { AnalystFab } from '../../components/analyst/AnalystFab';
import { useMe } from '@/hooks/useMe';

export const Route = createFileRoute('/admin')({
  component: AdminRoute,
});

/**
 * Feature-flag gate for the legacy operator console (§11 PR #10).
 * Admin access is granted if EITHER:
 *   - the `/api/v1/me` response carries `is_admin === true`, or
 *   - the build/runtime sets `VITE_ENABLE_ADMIN=true` (dev/staging escape hatch).
 * This is intentionally permissive for v1 until a real role system lands.
 */
function useIsAdmin(): { allowed: boolean; loading: boolean } {
  const me = useMe();
  const envFlag = import.meta.env.VITE_ENABLE_ADMIN === 'true';
  if (envFlag) return { allowed: true, loading: false };
  return {
    allowed: me.data?.is_admin === true,
    loading: me.isLoading,
  };
}

function AdminRoute(): JSX.Element {
  const { allowed, loading } = useIsAdmin();

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[100dvh] w-full items-center justify-center bg-neutral-50 text-sm text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400"
      >
        Checking admin access…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-neutral-50 px-6 dark:bg-neutral-950">
        <div
          role="alert"
          className="max-w-sm rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Admin console — access restricted
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            You don&apos;t have permission to view the operator console.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-900"
          >
            ← Back to Overview
          </Link>
        </div>
      </div>
    );
  }

  return <AdminConsole />;
}

function AdminConsole(): JSX.Element {
  // Ph2 A: MapShell self-fetches via viewport-driven bbox and renders its own
  // loading/error chips internally (useRemote mode).
  return (
    <div className="w-full h-[100dvh] bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <PanelGroup direction="vertical" className="w-full h-full">
        <Panel defaultSize={60} minSize={30} className="relative min-h-[420px]">
          <MapShell />
        </Panel>
        <PanelResizeHandle className="h-1.5 bg-neutral-200 hover:bg-indigo-400 transition-colors dark:bg-neutral-800" />
        <Panel defaultSize={40} minSize={15} className="overflow-auto">
          <WidgetGrid
            widgets={[
              <MacroDashboardWidget key="macro" />,
              <MarketTickerWidget key="ticker" />,
              <IndustryHeatmapWidget key="heatmap" />,
              <TopCompaniesWidget key="top" />,
              <SizeDistributionWidget key="size" />,
              <RecentTendersWidget key="tenders" />,
              <NewsFeedWidget key="news" />,
            ]}
          />
        </Panel>
      </PanelGroup>
      <CompanyDeepDrawer />
      <AnalystDrawer />
      <AnalystFab />
    </div>
  );
}
