import type { ReactNode } from 'react';
import { Header } from './Header';
import { SavedListsSidebar } from '@/components/lists/SavedListsSidebar';
import { useAuth } from '@/services/auth';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Top-level layout shell. Header + optional left sidebar + main outlet.
 *
 * The sidebar renders for authenticated users only and currently hosts the
 * "My lists" section (Track F). It collapses via `useUIStore.sidebarCollapsed`.
 */
export function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const showSidebar = Boolean(user) && !collapsed;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {showSidebar ? (
          <aside
            data-testid="app-sidebar"
            className={cn(
              'flex w-56 shrink-0 flex-col overflow-y-auto border-r border-[color:var(--border)]',
              'bg-[color:var(--card)]',
            )}
          >
            <SavedListsSidebar />
          </aside>
        ) : null}
        <main className="relative flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
