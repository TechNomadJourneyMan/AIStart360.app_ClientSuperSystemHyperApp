import { Moon, Search, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/cn';
import { UserMenu } from '@/components/auth/UserMenu';
import { isEmbedMode } from '@/lib/embed';

const navLinkClass = cn(
  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
  'text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
);
const navLinkActiveClass = cn(
  'bg-[color:var(--accent)] text-[color:var(--foreground)]',
);

export function Header() {
  const { t } = useTranslation();
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);

  // Embedded inside the AIStart360 portal iframe: the portal renders its own
  // tabs + auth, so the SPA drops its logo, primary nav and sign-in button and
  // shows only a slim search bar (+ theme toggle).
  if (isEmbedMode()) {
    return (
      <header
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 border-b border-[color:var(--border)]',
          'bg-[color:var(--card)] px-4 font-terminal',
        )}
      >
        <div className="flex flex-1 items-center">
          <SearchTrigger onOpen={() => setSearchOpen(true)} label={t('search.placeholder')} />
        </div>
        <ThemeToggle />
      </header>
    );
  }

  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-4 border-b border-[color:var(--border)]',
        'bg-[color:var(--card)] px-4 font-terminal',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="grid h-6 w-6 place-items-center rounded-sm bg-[color:var(--primary)] text-[10px] font-bold text-[color:var(--primary-foreground)]"
        >
          MK
        </div>
        <span className="text-sm font-semibold tracking-tight">
          {t('app.title')}
        </span>
      </div>

      {/* Primary navigation */}
      <nav className="flex items-center gap-1" aria-label="Primary">
        <Link
          to="/"
          className={navLinkClass}
          activeProps={{ className: navLinkActiveClass }}
          activeOptions={{ exact: true }}
        >
          {t('nav.map')}
        </Link>
        <Link
          to="/competitors"
          className={navLinkClass}
          activeProps={{ className: navLinkActiveClass }}
        >
          {t('nav.marketAnalysis')}
        </Link>
      </nav>

      {/* Search trigger — opens the global Cmd+K search modal. */}
      <div className="ml-4 flex max-w-xl flex-1 items-center">
        <SearchTrigger onOpen={() => setSearchOpen(true)} label={t('search.placeholder')} />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

/** Search trigger button that opens the global Cmd+K search modal. */
function SearchTrigger({ onOpen, label }: { onOpen: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={cn(
        'relative flex h-7 w-full items-center rounded-md border border-[color:var(--input)] bg-[color:var(--background)]',
        'pl-7 pr-12 text-left text-xs text-[color:var(--muted-foreground)]',
        'hover:border-[color:var(--ring)]',
      )}
    >
      <Search
        className="absolute left-2 h-3.5 w-3.5 text-[color:var(--muted-foreground)]"
        aria-hidden
      />
      <span>{label}</span>
      <kbd className="pointer-events-none absolute right-2 hidden h-4 select-none items-center gap-0.5 rounded border border-[color:var(--border)] bg-[color:var(--muted)] px-1 font-mono text-[10px] font-medium text-[color:var(--muted-foreground)] sm:flex">
        <span className="text-[10px]">⌘</span>K
      </kbd>
    </button>
  );
}

/** Light/dark theme toggle button. */
function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md border border-transparent',
        'text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]',
        'hover:text-[color:var(--accent-foreground)]',
      )}
    >
      {theme === 'dark' ? (
        <Sun className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Moon className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
