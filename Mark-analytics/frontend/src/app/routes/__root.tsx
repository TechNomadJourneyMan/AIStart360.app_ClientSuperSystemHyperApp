import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthModal } from '@/components/auth/AuthModal';
import { SearchModal } from '@/components/modals/SearchModal';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';

const TanStackRouterDevtools =
  import.meta.env.PROD || import.meta.env.VITE_ENABLE_DEVTOOLS !== 'true'
    ? () => null
    : lazy(() =>
        import('@tanstack/router-devtools').then((m) => ({
          default: m.TanStackRouterDevtools,
        })),
      );

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useGlobalShortcuts();
  return (
    <AppShell>
      <Outlet />
      <AuthModal />
      <SearchModal />
      <Suspense fallback={null}>
        <TanStackRouterDevtools position="bottom-right" />
      </Suspense>
    </AppShell>
  );
}
