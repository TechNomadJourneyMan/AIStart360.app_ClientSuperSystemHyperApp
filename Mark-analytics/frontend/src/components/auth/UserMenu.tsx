import { useState } from 'react';
import {
  LogOut,
  Settings,
  Activity,
  User as UserIcon,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { useAuth } from '@/services/auth';
import { useMe, useMyUsage } from '@/hooks/useMe';
import { useUIStore } from '@/stores/ui';

export function UserMenu() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);

  if (authLoading) {
    return (
      <div
        aria-label={t('common.loading')}
        className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--muted-foreground)]"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAuthModalOpen(true)}
        className="h-7"
      >
        <UserIcon className="h-3.5 w-3.5" aria-hidden />
        {t('auth.signIn')}
      </Button>
    );
  }

  return <SignedInMenu />;
}

function SignedInMenu() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const me = useMe();
  const usage = useMyUsage();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const initial = (() => {
    const fromMe = me.data?.full_name?.trim() || me.data?.email;
    const fromAuth = user?.email ?? '';
    const src = fromMe ?? fromAuth;
    return (src || '?').charAt(0).toUpperCase();
  })();

  const tier = me.data?.tier ?? 'free';
  const displayName = me.data?.full_name?.trim() || me.data?.email || user?.email || '';

  const searchesUsed = usage.data?.searches.used;
  const searchesLimit = usage.data?.searches.limit;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      qc.removeQueries({ queryKey: ['me'] });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={displayName}
          className={cn(
            'flex h-7 items-center gap-2 rounded-md border border-transparent px-1.5',
            'text-xs text-[color:var(--foreground)]',
            'hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
          )}
        >
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full bg-[color:var(--primary)] text-[10px] font-bold text-[color:var(--primary-foreground)]"
          >
            {initial}
          </span>
          <span className="hidden max-w-[10rem] truncate sm:inline">{displayName}</span>
          <ChevronDown className="h-3 w-3 text-[color:var(--muted-foreground)]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-xs font-medium normal-case tracking-normal text-[color:var(--foreground)]">
              {displayName || '—'}
            </span>
            <TierBadge tier={tier} />
          </div>
        </DropdownMenuLabel>

        {searchesLimit !== undefined && searchesUsed !== undefined && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <span>{t('auth.usage')}</span>
                <span className="font-medium normal-case tracking-normal text-[color:var(--foreground)]">
                  {searchesUsed} / {searchesLimit}
                </span>
              </div>
              <UsageBar used={searchesUsed} limit={searchesLimit} />
            </div>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserIcon className="h-3.5 w-3.5" aria-hidden />
          {t('auth.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="h-3.5 w-3.5" aria-hidden />
          {t('auth.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {t('auth.usage')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(e) => {
            e.preventDefault();
            void handleSignOut();
          }}
          className="text-[color:var(--destructive)] focus:text-[color:var(--destructive)]"
        >
          {signingOut ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <LogOut className="h-3.5 w-3.5" aria-hidden />
          )}
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const isPaid = tier !== 'free';
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        isPaid
          ? 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
          : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
      )}
    >
      {tier}
    </span>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = pct >= 90;
  const warning = !danger && pct >= 80;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--muted)]"
    >
      <div
        className={cn(
          'h-full rounded-full transition-all',
          danger
            ? 'bg-[color:var(--destructive)]'
            : warning
              ? 'bg-amber-500'
              : 'bg-[color:var(--primary)]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
